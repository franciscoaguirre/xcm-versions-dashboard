import { Binary, Blake2256 } from '@polkadot-api/substrate-bindings';
import {
  CHAIN_TIMEOUT_MS,
  callRuntimeApi,
  hasRuntimeApi,
  maxVersionedXcm,
  openReader,
  websocketEndpoints,
  withTimeout,
  type ChainReader,
} from './collect';
import type { Fix, ParsedJunction, ParsedLocation } from './fixes';
import { resolveLocation } from './location';
import { connectAny } from './rpc';
import type { ChainInfo, ChainKey, ChainReport, RelayName } from './types';

/** Para ID of Asset Hub, where each relay's governance lives since the Asset Hub migration. */
export const ASSET_HUB_PARA_ID = 1000;

/** Para IDs below this are system chains, which accept Superuser from Asset Hub. */
const FIRST_NON_SYSTEM_PARA_ID = 2000;

/** `fallback_max_weight` is this many times the measured weight of the call it carries. */
const FALLBACK_WEIGHT_MARGIN = 2n;

/** Per fix, for runtimes that can't measure a call's weight. Far above what a force call costs. */
const DEFAULT_WEIGHT_PER_FIX = { ref_time: 1_000_000_000n, proof_size: 64_000n };

export const isSystemChain = (chain: ChainInfo) => chain.paraId === null || chain.paraId < FIRST_NON_SYSTEM_PARA_ID;

export const assetHubKey = (relay: RelayName): ChainKey => `${relay}:${ASSET_HUB_PARA_ID}`;

export interface RemotePart {
  /** The system chain the fixes are for, reached by XCM from Asset Hub. */
  destinationKey: ChainKey;
  fixes: Fix[];
}

export interface ProposalPlan {
  /** `polkadot-system`, `kusama-2023`, ... Also the name of the script's output file. */
  id: string;
  /** `system`: one Asset Hub referendum for the relay and every system chain. `chain`: that chain's own. */
  kind: 'system' | 'chain';
  relay: RelayName;
  /** The chain whose governance submits the call. */
  submitOnKey: ChainKey;
  /** Fixes applied on the submitting chain itself. */
  local: Fix[];
  /** System proposals only: fixes sent to other system chains as `Transact` with Superuser origin. */
  remote: RemotePart[];
  /** Why the call can't be prepared, if it can't. */
  problem?: string;
}

const compareKeys = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The relay sorts before its parachains: `polkadot:relay` would otherwise sort after `polkadot:2000`. */
const chainOrder = (chain: ChainInfo) => chain.paraId ?? -1;

/** Group fixes into the referenda that apply them: one per relay for system chains, one per other chain. */
export const planProposals = (fixes: Fix[], reports: ChainReport[]): ProposalPlan[] => {
  const byKey = new Map(reports.map((report) => [report.chain.key, report]));
  const byHolder = new Map<ChainKey, Fix[]>();
  for (const fix of fixes) byHolder.set(fix.holderKey, [...(byHolder.get(fix.holderKey) ?? []), fix]);

  const holders = [...byHolder.keys()]
    .map((key) => byKey.get(key)?.chain)
    .filter((chain): chain is ChainInfo => chain !== undefined)
    .sort((a, b) => compareKeys(a.relay, b.relay) || chainOrder(a) - chainOrder(b));

  const systemPlans: ProposalPlan[] = [];
  for (const relay of [...new Set(holders.map((chain) => chain.relay))]) {
    const systemHolders = holders.filter((chain) => chain.relay === relay && isSystemChain(chain));
    if (!systemHolders.length) continue;
    const submitOnKey = assetHubKey(relay);
    const assetHub = byKey.get(submitOnKey);
    systemPlans.push({
      id: `${relay}-system`,
      kind: 'system',
      relay,
      submitOnKey,
      local: byHolder.get(submitOnKey) ?? [],
      remote: systemHolders
        .filter((chain) => chain.key !== submitOnKey)
        .map((chain) => ({ destinationKey: chain.key, fixes: byHolder.get(chain.key)! })),
      problem: assetHub?.snapshot?.state === 'ok' ? undefined : `${submitOnKey} (Asset Hub) could not be read`,
    });
  }

  const chainPlans = holders
    .filter((chain) => !isSystemChain(chain))
    .map(
      (chain): ProposalPlan => ({
        id: `${chain.relay}-${chain.paraId}`,
        kind: 'chain',
        relay: chain.relay,
        submitOnKey: chain.key,
        local: byHolder.get(chain.key)!,
        remote: [],
      }),
    );

  return [...systemPlans, ...chainPlans];
};

// Values in the shape PAPI's dynamic codecs encode: enums are `{ type, value }`, `None` is `undefined`.

const junctionValue = (junction: ParsedJunction) =>
  'Parachain' in junction
    ? { type: 'Parachain', value: junction.Parachain }
    : { type: 'GlobalConsensus', value: { type: junction.GlobalConsensus, value: undefined } };

/** A plain V4+ `Location`. PAPI represents `X1([Junction; 1])` as the bare junction. */
export const locationValue = ({ parents, junctions }: ParsedLocation) => ({
  parents,
  interior: junctions.length
    ? {
        type: `X${junctions.length}`,
        value: junctions.length === 1 ? junctionValue(junctions[0]) : junctions.map(junctionValue),
      }
    : { type: 'Here', value: undefined },
});

/** The `RuntimeCall` value for one fix, on a chain whose XCM pallet is `palletName`. */
export const forceCallValue = (palletName: string, fix: Fix) => ({
  type: palletName,
  value:
    fix.kind === 'stale-record'
      ? { type: 'force_xcm_version', value: { location: locationValue(fix.location!), version: fix.newVersion } }
      : { type: 'force_default_xcm_version', value: { maybe_xcm_version: fix.newVersion } },
});

/** A single call stays as it is; several become one `Utility.batch_all`, which applies all or nothing. */
export const batchValue = (calls: unknown[]) =>
  calls.length === 1 ? calls[0] : { type: 'Utility', value: { type: 'batch_all', value: { calls } } };

const parachainLocation = (parents: number, paraId: number): ParsedLocation => ({
  parents,
  junctions: [{ Parachain: paraId }],
});

const paraIdOf = (key: ChainKey) => {
  const id = key.split(':')[1];
  return id === 'relay' ? null : Number(id);
};

/** Where Asset Hub sends a system chain's fixes: its relay, or a sibling. */
export const destinationFromAssetHub = (key: ChainKey): ParsedLocation => {
  const paraId = paraIdOf(key);
  return paraId === null ? { parents: 1, junctions: [] } : parachainLocation(1, paraId);
};

/** Asset Hub as the destination sees it: the origin of the message it receives. */
export const assetHubSeenFrom = (key: ChainKey): ParsedLocation =>
  parachainLocation(paraIdOf(key) === null ? 0 : 1, ASSET_HUB_PARA_ID);

export interface Weight {
  ref_time: bigint;
  proof_size: bigint;
}

/**
 * The message Asset Hub sends: run `call` on the destination as Root. System chains accept
 * Superuser from Asset Hub and execute its messages for free, hence `UnpaidExecution`.
 * `fallback_max_weight` only matters if the message has to be downgraded to v4.
 */
export const remoteMessage = (call: Uint8Array, fallbackWeight: Weight) => [
  {
    type: 'UnpaidExecution',
    value: { weight_limit: { type: 'Unlimited', value: undefined }, check_origin: undefined },
  },
  {
    type: 'Transact',
    value: { origin_kind: { type: 'Superuser', value: undefined }, fallback_max_weight: fallbackWeight, call },
  },
];

const versioned = (version: number, value: unknown) => ({ type: `V${version}`, value });

export const sendValue = (palletName: string, destination: ParsedLocation, message: unknown[], version: number) => ({
  type: palletName,
  value: {
    type: 'send',
    value: { dest: versioned(version, locationValue(destination)), message: versioned(version, message) },
  },
});

// Preparing and dry-running.

export interface DryRunCheck {
  chainKey: ChainKey;
  passed: boolean;
  detail: string;
}

export interface DryRunResult {
  /** `unavailable`: some runtime lacks `DryRunApi`, and nothing that could run failed. */
  status: 'passed' | 'failed' | 'unavailable';
  checks: DryRunCheck[];
}

export interface PreparedRemoteCall {
  destinationKey: ChainKey;
  /** The call executed on the destination, as encoded inside `Transact`. */
  callData: string;
  fallbackWeight: { ref_time: string; proof_size: string };
}

export interface PreparedProposal {
  plan: ProposalPlan;
  submitOn: { key: ChainKey; endpoint: string; specName: string; specVersion: number };
  /** The call to note as a preimage and submit to governance. */
  callData: string;
  /** Blake2-256 of the call data: the preimage hash. */
  callHash: string;
  length: number;
  /** Opens the call data in polkadot.js apps' decoder, on the chain it was encoded for. */
  decodeUrl: string;
  remoteCalls: PreparedRemoteCall[];
  dryRun: DryRunResult;
}

/** JSON-safe rendering of decoded values for messages: bigints as strings, bytes as hex. */
export const describe = (value: unknown) =>
  JSON.stringify(value, (_, item) =>
    typeof item === 'bigint' ? item.toString() : item instanceof Uint8Array ? Binary.toHex(item) : item,
  );

interface OpenChain {
  report: ChainReport;
  reader: ChainReader;
  palletName: string;
  callCodec: ReturnType<ChainReader['builder']['buildDefinition']>;
  close: () => void;
}

const openChain = async (report: ChainReport): Promise<OpenChain> => {
  if (report.snapshot?.state !== 'ok' || !report.snapshot.palletName) {
    throw new Error(`${report.chain.name} could not be read`);
  }
  const endpoints = [...new Set([report.snapshot.endpoint, ...websocketEndpoints(report.chain)])].filter(
    (endpoint): endpoint is string => !!endpoint,
  );
  const errors: string[] = [];
  for (const endpoint of endpoints) {
    const rpc = await connectAny([endpoint]).catch((error: Error) => {
      errors.push(error.message);
      return undefined;
    });
    if (!rpc) continue;
    try {
      const reader = await withTimeout(openReader(rpc, true), CHAIN_TIMEOUT_MS, endpoint);
      if (reader.lookup.call === null) throw new Error(`${endpoint}: metadata has no RuntimeCall type`);
      return {
        report,
        reader,
        palletName: report.snapshot.palletName,
        callCodec: reader.builder.buildDefinition(reader.lookup.call),
        close: () => rpc.close(),
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      rpc.close();
    }
  }
  throw new Error(`${report.chain.name}: ${errors.join('; ') || 'no public WebSocket endpoint'}`);
};

const hasUtility = (chain: OpenChain) =>
  chain.reader.metadata.pallets.some((pallet) => pallet.name === 'Utility' && pallet.calls !== undefined);

const localCallValue = (chain: OpenChain, fixes: Fix[]) => {
  const calls = fixes.map((fix) => forceCallValue(chain.palletName, fix));
  if (calls.length > 1 && !hasUtility(chain)) throw new Error(`${chain.report.chain.name} has no Utility pallet to batch with`);
  return calls;
};

/** The weight to declare for `call` on `chain`, with margin. */
const fallbackWeightFor = async (chain: OpenChain, callValue: unknown, encoded: Uint8Array, fixCount: number) => {
  if (!hasRuntimeApi(chain.reader, 'TransactionPaymentCallApi', 'query_call_info')) {
    const count = BigInt(fixCount);
    return { ref_time: DEFAULT_WEIGHT_PER_FIX.ref_time * count, proof_size: DEFAULT_WEIGHT_PER_FIX.proof_size * count };
  }
  const info = (await callRuntimeApi(chain.reader, 'TransactionPaymentCallApi', 'query_call_info', callValue, encoded.length)) as {
    weight: Weight;
  };
  // Runtimes often report no proof size for these calls; keep a floor in case the measurement is low.
  const proofSize = info.weight.proof_size * FALLBACK_WEIGHT_MARGIN;
  return {
    ref_time: info.weight.ref_time * FALLBACK_WEIGHT_MARGIN,
    proof_size: proofSize > DEFAULT_WEIGHT_PER_FIX.proof_size ? proofSize : DEFAULT_WEIGHT_PER_FIX.proof_size,
  };
};

interface RuntimeEvent {
  type: string;
  value: { type: string; value: unknown };
}

const countEvents = (events: RuntimeEvent[], pallet: string, name: string) =>
  events.filter((event) => event.type === pallet && event.value?.type === name).length;

const staleCount = (fixes: Fix[]) => fixes.filter((fix) => fix.kind === 'stale-record').length;

/** `3 records set, fallback raised to v4`. The fallback emits no event; its call fails only on a bad origin. */
const appliedSummary = (fixes: Fix[], changed: number) => {
  const fallback = fixes.find((fix) => fix.kind === 'fallback-version');
  return [`${changed} records set`, ...(fallback ? [`fallback raised to v${fallback.newVersion}`] : [])].join(', ');
};

const DRY_RUN = ['DryRunApi', 'dry_run_call'] as const;
const DRY_RUN_XCM = ['DryRunApi', 'dry_run_xcm'] as const;

interface DryRunCallOutcome {
  check: DryRunCheck;
  forwarded: [unknown, unknown[]][];
}

/** Dry-run `callValue` as Root on `chain`, checking every stale record got set. */
const dryRunCall = async (
  chain: OpenChain,
  callValue: unknown,
  fixes: Fix[],
  sends: number,
  resultXcmsVersion: number,
): Promise<DryRunCallOutcome | null> => {
  const { reader, report, palletName } = chain;
  if (!hasRuntimeApi(reader, ...DRY_RUN)) return null;
  const origin = { type: 'system', value: { type: 'Root', value: undefined } };
  const inputs = reader.metadata.apis.find((api) => api.name === DRY_RUN[0])!.methods.find((method) => method.name === DRY_RUN[1])!.inputs;
  const args = inputs.length > 2 ? [origin, callValue, resultXcmsVersion] : [origin, callValue];
  const result = (await callRuntimeApi(reader, ...DRY_RUN, ...args)) as {
    success: boolean;
    value: any;
  };
  const fail = (detail: string): DryRunCallOutcome => ({ check: { chainKey: report.chain.key, passed: false, detail }, forwarded: [] });
  if (!result.success) return fail(`dry run rejected: ${describe(result.value)}`);
  const effects = result.value as {
    execution_result: { success: boolean; value: any };
    emitted_events: RuntimeEvent[];
    forwarded_xcms: [unknown, unknown[]][];
  };
  if (!effects.execution_result.success) return fail(`call failed as Root: ${describe(effects.execution_result.value.error ?? effects.execution_result.value)}`);
  const changed = countEvents(effects.emitted_events, palletName, 'SupportedVersionChanged');
  const sent = countEvents(effects.emitted_events, palletName, 'Sent');
  if (changed !== staleCount(fixes)) return fail(`expected ${staleCount(fixes)} SupportedVersionChanged events, got ${changed}`);
  if (sent !== sends) return fail(`expected ${sends} Sent events, got ${sent}`);
  const summary = [appliedSummary(fixes, changed), ...(sends ? [`${sent} messages sent`] : [])].join(', ');
  return {
    check: { chainKey: report.chain.key, passed: true, detail: `executed as Root: ${summary}` },
    forwarded: effects.forwarded_xcms,
  };
};

/** Execute what Asset Hub forwarded to `chain`, as if it came from Asset Hub. */
const dryRunReceived = async (chain: OpenChain, messages: unknown[], fixes: Fix[]): Promise<DryRunCheck | null> => {
  const { reader, report, palletName } = chain;
  if (!hasRuntimeApi(reader, ...DRY_RUN_XCM)) return null;
  const fail = (detail: string): DryRunCheck => ({ chainKey: report.chain.key, passed: false, detail });
  if (messages.length !== 1) return fail(`expected 1 message from Asset Hub, got ${messages.length}`);
  const message = messages[0] as { type: string };
  const origin = versioned(Number(message.type.slice(1)), locationValue(assetHubSeenFrom(report.chain.key)));
  const result = (await callRuntimeApi(reader, ...DRY_RUN_XCM, origin, message)) as { success: boolean; value: any };
  if (!result.success) return fail(`dry run rejected: ${describe(result.value)}`);
  const effects = result.value as { execution_result: { type: string; value: any }; emitted_events: RuntimeEvent[] };
  if (effects.execution_result.type !== 'Complete') return fail(`message from Asset Hub ${effects.execution_result.type}: ${describe(effects.execution_result.value)}`);
  const changed = countEvents(effects.emitted_events, palletName, 'SupportedVersionChanged');
  if (changed !== staleCount(fixes)) return fail(`expected ${staleCount(fixes)} SupportedVersionChanged events, got ${changed}`);
  return { chainKey: report.chain.key, passed: true, detail: `executed with Superuser from Asset Hub: ${appliedSummary(fixes, changed)}` };
};

const summarize = (checks: DryRunCheck[], unavailable: ChainKey[]): DryRunResult => {
  for (const chainKey of unavailable) checks.push({ chainKey, passed: false, detail: 'runtime has no DryRunApi' });
  if (checks.some((check) => !check.passed && !unavailable.includes(check.chainKey))) return { status: 'failed', checks };
  return { status: unavailable.length ? 'unavailable' : 'passed', checks };
};

const encode = (chain: OpenChain, value: unknown) => chain.callCodec.enc(value);

/** Encode a plan's call against the live runtimes involved, and dry-run it. */
export const prepareProposal = async (plan: ProposalPlan, reports: ChainReport[]): Promise<PreparedProposal> => {
  if (plan.problem) throw new Error(plan.problem);
  const byKey = new Map(reports.map((report) => [report.chain.key, report]));
  const reportOf = (key: ChainKey) => {
    const report = byKey.get(key);
    if (!report) throw new Error(`${key} is not among the checked chains`);
    return report;
  };

  const opened: OpenChain[] = [];
  try {
    const submitOn = await openChain(reportOf(plan.submitOnKey));
    opened.push(submitOn);
    const destinations = await Promise.all(plan.remote.map((part) => openChain(reportOf(part.destinationKey))));
    opened.push(...destinations);

    // Encode the message at the highest version both ends know; Asset Hub's router downgrades it if needed.
    const versionOf = (chain: OpenChain) => maxVersionedXcm(chain.reader.metadata) ?? 3;
    const messageVersion = Math.min(...opened.map(versionOf));

    const remoteCalls: PreparedRemoteCall[] = [];
    const sends: unknown[] = [];
    for (const [index, part] of plan.remote.entries()) {
      const destination = destinations[index];
      const callValue = batchValue(localCallValue(destination, part.fixes));
      const encoded = encode(destination, callValue);
      const weight = await fallbackWeightFor(destination, callValue, encoded, part.fixes.length);
      remoteCalls.push({
        destinationKey: part.destinationKey,
        callData: Binary.toHex(encoded),
        fallbackWeight: { ref_time: weight.ref_time.toString(), proof_size: weight.proof_size.toString() },
      });
      sends.push(
        sendValue(submitOn.palletName, destinationFromAssetHub(part.destinationKey), remoteMessage(encoded, weight), messageVersion),
      );
    }

    // Asset Hub's own records first, so the sends below already use the corrected versions.
    const calls = [...(plan.local.length ? localCallValue(submitOn, plan.local) : []), ...sends];
    if (calls.length > 1 && !hasUtility(submitOn)) throw new Error(`${submitOn.report.chain.name} has no Utility pallet to batch with`);
    const callValue = batchValue(calls);
    const encoded = encode(submitOn, callValue);
    const callData = Binary.toHex(encoded);

    const checks: DryRunCheck[] = [];
    const unavailable: ChainKey[] = [];
    const local = await dryRunCall(submitOn, callValue, plan.local, sends.length, messageVersion);
    if (!local) unavailable.push(plan.submitOnKey);
    else checks.push(local.check);

    if (local?.check.passed) {
      const context = { relay: plan.relay, paraId: ASSET_HUB_PARA_ID };
      for (const [index, part] of plan.remote.entries()) {
        const forwarded = local.forwarded.filter(([location]) => resolveLocation(location, context).peerKey === part.destinationKey);
        const check = await dryRunReceived(destinations[index], forwarded.flatMap(([, messages]) => messages), part.fixes);
        if (!check) unavailable.push(part.destinationKey);
        else checks.push(check);
      }
    }

    const endpoint = submitOn.reader.rpc.endpoint;
    const runtime = await submitOn.reader.rpc.request<{ specName: string; specVersion: number }>('state_getRuntimeVersion', [
      submitOn.reader.at,
    ]);
    return {
      plan,
      submitOn: { key: plan.submitOnKey, endpoint, specName: runtime.specName, specVersion: runtime.specVersion },
      callData,
      callHash: Binary.toHex(Blake2256(encoded)),
      length: encoded.length,
      decodeUrl: `https://polkadot.js.org/apps/?rpc=${encodeURIComponent(endpoint)}#/extrinsics/decode/${callData}`,
      remoteCalls,
      dryRun: summarize(checks, unavailable),
    };
  } finally {
    for (const chain of opened) chain.close();
  }
};
