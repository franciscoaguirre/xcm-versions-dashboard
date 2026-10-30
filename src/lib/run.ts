import knownChains from '../data/chains.json';
import extraEndpoints from '../data/extra-endpoints.json';
import { BLOCKS_PER_DAY, classifyActivity } from './activity';
import { collectChain, fetchParaActivity, runPool } from './collect';
import type { ChainInfo, ChainSnapshot, RelayName } from './types';

export const CONCURRENCY = 8;

const RELAYS: RelayName[] = ['polkadot', 'kusama'];

/**
 * The chains to check: each relay plus every para that included a block within the last year.
 * Paras missing from apps-config are kept as "Unknown" so nothing slips through.
 */
export const resolveLiveChains = async (): Promise<ChainInfo[]> => {
  const all = knownChains as ChainInfo[];
  const perRelay = await Promise.all(
    RELAYS.map(async (relay) => {
      const relayChain: ChainInfo = { ...all.find((chain) => chain.key === `${relay}:relay`)!, activity: 'active' };
      const parachains = (await fetchParaActivity(relayChain))
        .map(({ paraId, blocksSinceInclusion }): ChainInfo | null => {
          const activity = classifyActivity(blocksSinceInclusion);
          if (activity === 'retired') return null;
          const key = `${relay}:${paraId}`;
          const known = all.find((chain) => chain.key === key);
          const extra = (extraEndpoints as Record<string, string[]>)[key] ?? [];
          return {
            ...(known ?? { key, relay, paraId, name: `Unknown (para ${paraId})`, providers: [] }),
            // Verified endpoints apps-config lacks; see scripts/verify-endpoint.ts.
            providers: [...(known?.providers ?? []), ...extra],
            activity,
            daysSinceLastBlock: Math.floor(blocksSinceInclusion / BLOCKS_PER_DAY),
          };
        })
        .filter((chain): chain is ChainInfo => chain !== null)
        .sort((a, b) => a.paraId! - b.paraId!);
      return [relayChain, ...parachains];
    }),
  );
  return perRelay.flat();
};

export const collectAll = (
  chains: ChainInfo[],
  onSnapshot: (snapshot: ChainSnapshot, chain: ChainInfo) => void,
) => runPool(chains, CONCURRENCY, collectChain, onSnapshot);
