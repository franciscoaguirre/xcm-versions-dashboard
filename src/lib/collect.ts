import { getDynamicBuilder, getLookupFn } from '@polkadot-api/metadata-builders';
import { Binary, Bytes, Option, decAnyMetadata, u32, unifyMetadata } from '@polkadot-api/substrate-bindings';
import { resolveLocation } from './location';
import { latestPerLocation, legacyKeyedEntries, undecodableLegacyEntry } from './records';
import { connectAny, type RpcClient } from './rpc';
import type { ChainInfo, ChainSnapshot, VersionRecord } from './types';

/** Per endpoint attempt. */
export const CHAIN_TIMEOUT_MS = 30_000;
const KEYS_PAGE_SIZE = 1000;
const VALUES_CHUNK_SIZE = 100;

export type Metadata = ReturnType<typeof unifyMetadata>;
export type Builder = ReturnType<typeof getDynamicBuilder>;

export const withTimeout = <T>(promise: Promise<T>, milliseconds: number, label: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds / 1000}s`)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export const findXcmPallet = (metadata: Metadata) =>
  metadata.pallets.find((pallet) => {
    const names = pallet.storage?.items.map((item) => item.name) ?? [];
    return names.includes('SupportedVersion') && names.includes('VersionNotifyTargets');
  });

/** Highest `V<n>` variant across every `VersionedXcm` type in the metadata. */
export const maxVersionedXcm = (metadata: Metadata): number | undefined => {
  const versions = metadata.lookup
    .filter((type) => type.path.at(-1) === 'VersionedXcm' && type.def.tag === 'variant')
    .flatMap((type) => (type.def.tag === 'variant' ? type.def.value.map((variant) => variant.name) : []))
    .map((name) => /^V(\d+)$/.exec(name)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .map(Number);
  return versions.length ? Math.max(...versions) : undefined;
};

export const websocketEndpoints = (chain: ChainInfo) =>
  chain.providers.filter((url) => url.startsWith('wss://'));

export interface ChainReader {
  rpc: RpcClient;
  at: string;
  metadata: Metadata;
  lookup: ReturnType<typeof getLookupFn>;
  builder: Builder;
}

const versionedMetadata = Option(Bytes());

/**
 * The runtime's metadata at `at`. `state_getMetadata` returns V14, which lists no runtime APIs,
 * so callers that need them ask for the newest version the runtime offers.
 */
const fetchMetadata = async (rpc: RpcClient, at: string, withRuntimeApis: boolean) => {
  if (withRuntimeApis) {
    for (const version of [16, 15]) {
      try {
        const raw = await rpc.request<string>('state_call', [
          'Metadata_metadata_at_version',
          Binary.toHex(u32.enc(version)),
          at,
        ]);
        const opaque = versionedMetadata.dec(raw);
        if (opaque) return unifyMetadata(decAnyMetadata(opaque));
      } catch {
        // Older runtime without this version (or without the API at all): try the next one.
      }
    }
  }
  return unifyMetadata(decAnyMetadata(await rpc.request<string>('state_getMetadata', [at])));
};

/** Pass `withRuntimeApis` to load V15+ metadata, needed by `callRuntimeApi`. */
export const openReader = async (rpc: RpcClient, withRuntimeApis = false): Promise<ChainReader> => {
  const at = await rpc.request<string>('chain_getFinalizedHead');
  const header = await rpc.request<{ number: string }>('chain_getHeader', [at]);
  // An unsynced node reports genesis as finalized, and its genesis state has no XCM pallet.
  if (Number.parseInt(header.number, 16) === 0) throw new Error(`${rpc.endpoint}: node is not synced`);
  const metadata = await fetchMetadata(rpc, at, withRuntimeApis);
  const lookup = getLookupFn(metadata);
  return { rpc, at, metadata, lookup, builder: getDynamicBuilder(lookup) };
};

/** Whether the runtime exposes `api.method`. */
export const hasRuntimeApi = (reader: ChainReader, api: string, method: string) =>
  reader.metadata.apis.some((entry) => entry.name === api && entry.methods.some((item) => item.name === method));

/** Call a runtime API at the reader's block, e.g. `DryRunApi`, `dry_run_call`. */
export const callRuntimeApi = async (reader: ChainReader, api: string, method: string, ...args: unknown[]) => {
  const codecs = reader.builder.buildRuntimeCall(api, method);
  const raw = await reader.rpc.request<string>('state_call', [`${api}_${method}`, Binary.toHex(codecs.args.enc(args)), reader.at]);
  return codecs.value.dec(raw);
};

const readValue = async (reader: ChainReader, pallet: string, entry: string, ...args: unknown[]) => {
  const storage = reader.builder.buildStorage(pallet, entry);
  const raw = await reader.rpc.request<string | null>('state_getStorage', [storage.keys.enc(...args), reader.at]);
  return raw === null ? storage.fallback : storage.value.dec(raw);
};

const readEntries = async (reader: ChainReader, pallet: string, entry: string) => {
  const storage = reader.builder.buildStorage(pallet, entry);
  const prefix = storage.keys.enc();
  const keys: string[] = [];
  for (;;) {
    const page = await reader.rpc.request<string[]>('state_getKeysPaged', [
      prefix,
      KEYS_PAGE_SIZE,
      keys.at(-1) ?? prefix,
      reader.at,
    ]);
    keys.push(...page);
    if (page.length < KEYS_PAGE_SIZE) break;
  }

  const entries: { keyArgs: any[]; value: any }[] = [];
  // Keys the metadata can't decode, e.g. a location variant the runtime no longer has.
  const undecodableKeys: string[] = [];
  for (let start = 0; start < keys.length; start += VALUES_CHUNK_SIZE) {
    const chunk = keys.slice(start, start + VALUES_CHUNK_SIZE);
    const [result] = await reader.rpc.request<{ changes: [string, string | null][] }[]>('state_queryStorageAt', [
      chunk,
      reader.at,
    ]);
    for (const [key, value] of result.changes) {
      if (value === null) continue;
      let keyArgs: any[];
      try {
        keyArgs = storage.keys.dec(key);
      } catch {
        undecodableKeys.push(key);
        continue;
      }
      entries.push({ keyArgs, value: storage.value.dec(value) });
    }
  }
  return { entries, undecodableKeys };
};

export interface ParaActivity {
  paraId: number;
  blocksSinceInclusion: number;
}

/** For every para the relay has ever included, how many relay blocks ago that last happened. */
export const fetchParaActivity = async (relay: ChainInfo): Promise<ParaActivity[]> => {
  const rpc = await connectAny(websocketEndpoints(relay));
  try {
    const query = async () => {
      const reader = await openReader(rpc);
      const [current, { entries: contexts }] = await Promise.all([
        readValue(reader, 'System', 'Number'),
        readEntries(reader, 'Paras', 'MostRecentContext'),
      ]);
      return contexts.map(({ keyArgs, value }) => ({
        paraId: keyArgs[0] as number,
        blocksSinceInclusion: (current as number) - (value as number),
      }));
    };
    return await withTimeout(query(), CHAIN_TIMEOUT_MS, relay.name);
  } finally {
    rpc.close();
  }
};

const collect = async (chain: ChainInfo, rpc: RpcClient): Promise<ChainSnapshot> => {
  const reader = await openReader(rpc);
  const runtime = await rpc.request<{ specName: string; specVersion: number }>('state_getRuntimeVersion', [reader.at]);
  const base = {
    key: chain.key,
    endpoint: rpc.endpoint,
    specName: runtime.specName,
    specVersion: runtime.specVersion,
    maxInMetadata: maxVersionedXcm(reader.metadata),
  };

  const pallet = findXcmPallet(reader.metadata);
  if (!pallet) return { ...base, state: 'no-xcm-pallet', advertised: [], supported: [] };

  const context = { relay: chain.relay, paraId: chain.paraId };
  const toRecord = (keyVersion: number, location: unknown, version: number): VersionRecord => ({
    ...resolveLocation(location, context),
    version,
    keyVersion,
  });

  const [supportedVersion, versionNotifiers, versionNotifyTargets, safeVersion] = await Promise.all([
    readEntries(reader, pallet.name, 'SupportedVersion'),
    readEntries(reader, pallet.name, 'VersionNotifiers'),
    readEntries(reader, pallet.name, 'VersionNotifyTargets'),
    readValue(reader, pallet.name, 'SafeXcmVersion'),
  ]);
  const legacyKeyed = (
    [
      ['SupportedVersion', supportedVersion],
      ['VersionNotifiers', versionNotifiers],
      ['VersionNotifyTargets', versionNotifyTargets],
    ] as const
  ).flatMap(([map, { entries, undecodableKeys }]) => [
    ...legacyKeyedEntries(map, entries, context),
    ...undecodableKeys.map((key) => undecodableLegacyEntry(map, key)),
  ]);

  return {
    ...base,
    state: 'ok',
    palletName: pallet.name,
    safeVersion: safeVersion ?? undefined,
    supported: latestPerLocation(
      supportedVersion.entries.map(({ keyArgs, value }) => toRecord(keyArgs[0] as number, keyArgs[1], value as number)),
    ),
    // Value is (QueryId, max response weight, version advertised to that subscriber).
    advertised: latestPerLocation(
      versionNotifyTargets.entries.map(({ keyArgs, value }) =>
        toRecord(keyArgs[0] as number, keyArgs[1], (value as [bigint, unknown, number])[2]),
      ),
    ),
    legacyKeyed,
  };
};

export const collectChain = async (chain: ChainInfo): Promise<ChainSnapshot> => {
  const endpoints = websocketEndpoints(chain);
  const errors: string[] = [];
  // Each endpoint gets a full attempt: a node can accept the connection and still be
  // unsynced or rate-limited, in which case the next provider may be fine.
  for (const endpoint of endpoints) {
    let rpc: RpcClient | undefined;
    try {
      rpc = await connectAny([endpoint]);
      return await withTimeout(collect(chain, rpc), CHAIN_TIMEOUT_MS, endpoint);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      rpc?.close();
    }
  }
  return {
    key: chain.key,
    state: 'unreachable',
    error: errors.join('; ') || 'No public WebSocket endpoint',
    advertised: [],
    supported: [],
  };
};

/** Run `task` over `items` with at most `limit` in flight. */
export const runPool = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
  onResult?: (result: R, item: T) => void,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
      onResult?.(results[index], items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
