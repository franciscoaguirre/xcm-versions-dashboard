import { getDynamicBuilder, getLookupFn } from '@polkadot-api/metadata-builders';
import { decAnyMetadata, unifyMetadata } from '@polkadot-api/substrate-bindings';
import { resolveLocation } from './location';
import { latestPerLocation } from './records';
import { connectAny, type RpcClient } from './rpc';
import type { ChainInfo, ChainSnapshot, VersionRecord } from './types';

/** Per endpoint attempt. */
export const CHAIN_TIMEOUT_MS = 30_000;
const KEYS_PAGE_SIZE = 1000;
const VALUES_CHUNK_SIZE = 100;

type Metadata = ReturnType<typeof unifyMetadata>;
type Builder = ReturnType<typeof getDynamicBuilder>;

const withTimeout = <T>(promise: Promise<T>, milliseconds: number, label: string) =>
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

const findXcmPallet = (metadata: Metadata) =>
  metadata.pallets.find((pallet) => {
    const names = pallet.storage?.items.map((item) => item.name) ?? [];
    return names.includes('SupportedVersion') && names.includes('VersionNotifyTargets');
  });

/** Highest `V<n>` variant across every `VersionedXcm` type in the metadata. */
const maxVersionedXcm = (metadata: Metadata): number | undefined => {
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

interface ChainReader {
  rpc: RpcClient;
  at: string;
  metadata: Metadata;
  builder: Builder;
}

const openReader = async (rpc: RpcClient): Promise<ChainReader> => {
  const at = await rpc.request<string>('chain_getFinalizedHead');
  const header = await rpc.request<{ number: string }>('chain_getHeader', [at]);
  // An unsynced node reports genesis as finalized, and its genesis state has no XCM pallet.
  if (Number.parseInt(header.number, 16) === 0) throw new Error(`${rpc.endpoint}: node is not synced`);
  const metadata = unifyMetadata(decAnyMetadata(await rpc.request<string>('state_getMetadata', [at])));
  return { rpc, at, metadata, builder: getDynamicBuilder(getLookupFn(metadata)) };
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
  for (let start = 0; start < keys.length; start += VALUES_CHUNK_SIZE) {
    const chunk = keys.slice(start, start + VALUES_CHUNK_SIZE);
    const [result] = await reader.rpc.request<{ changes: [string, string | null][] }[]>('state_queryStorageAt', [
      chunk,
      reader.at,
    ]);
    for (const [key, value] of result.changes) {
      if (value !== null) entries.push({ keyArgs: storage.keys.dec(key), value: storage.value.dec(value) });
    }
  }
  return entries;
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
      const [current, contexts] = await Promise.all([
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

  const [supportedEntries, targetEntries, safeVersion] = await Promise.all([
    readEntries(reader, pallet.name, 'SupportedVersion'),
    readEntries(reader, pallet.name, 'VersionNotifyTargets'),
    readValue(reader, pallet.name, 'SafeXcmVersion'),
  ]);

  return {
    ...base,
    state: 'ok',
    palletName: pallet.name,
    safeVersion: safeVersion ?? undefined,
    supported: latestPerLocation(
      supportedEntries.map(({ keyArgs, value }) => toRecord(keyArgs[0] as number, keyArgs[1], value as number)),
    ),
    // Value is (QueryId, max response weight, version advertised to that subscriber).
    advertised: latestPerLocation(
      targetEntries.map(({ keyArgs, value }) =>
        toRecord(keyArgs[0] as number, keyArgs[1], (value as [bigint, unknown, number])[2]),
      ),
    ),
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
