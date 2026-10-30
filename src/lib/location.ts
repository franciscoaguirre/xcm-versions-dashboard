import type { ChainKey, RelayName } from './types';

interface Junction {
  type: string;
  value?: unknown;
}

interface DecodedLocation {
  type: string;
  value: { parents: number; interior: { type: string; value?: Junction | Junction[] } };
}

export interface LocationContext {
  relay: RelayName;
  /** `null` when the location was read on the relay chain. */
  paraId: number | null;
}

const BRIDGEABLE_NETWORKS: Record<string, RelayName> = { Polkadot: 'polkadot', Kusama: 'kusama' };

const junctionsOf = (interior: DecodedLocation['value']['interior']): Junction[] => {
  if (interior.type === 'Here' || interior.value === undefined) return [];
  // PAPI decodes a V4+ `X1([Junction; 1])` as a bare junction, V3 always does.
  return Array.isArray(interior.value) ? interior.value : [interior.value];
};

const junctionLabel = (junction: Junction): string => {
  if (junction.type === 'Parachain') return `Parachain(${junction.value})`;
  if (junction.type === 'GlobalConsensus') return `GlobalConsensus(${(junction.value as Junction).type})`;
  return junction.type;
};

/** Resolve a decoded `VersionedLocation` to the chain it points at, relative to where it was read. */
export const resolveLocation = (
  location: unknown,
  context: LocationContext,
): { peerKey: ChainKey | null; peerLabel: string } => {
  const { parents, interior } = (location as DecodedLocation).value;
  const junctions = junctionsOf(interior);
  const peerLabel = [...Array(parents).fill('..'), ...junctions.map(junctionLabel)].join('/') || 'Here';

  const [first, second] = junctions;
  const parachainOf = (junction?: Junction) =>
    junction?.type === 'Parachain' ? (junction.value as number) : undefined;

  let peerKey: ChainKey | null = null;
  const isOnRelay = context.paraId === null;
  // Number of hops up needed to reach the relay chain from the context.
  const parentsToRelay = isOnRelay ? 0 : 1;

  if (parents === parentsToRelay) {
    if (junctions.length === 0) peerKey = `${context.relay}:relay`;
    else if (junctions.length === 1 && parachainOf(first) !== undefined)
      peerKey = `${context.relay}:${parachainOf(first)}`;
  } else if (parents === parentsToRelay + 1 && first?.type === 'GlobalConsensus') {
    const network = BRIDGEABLE_NETWORKS[(first.value as Junction).type];
    if (network && junctions.length === 1) peerKey = `${network}:relay`;
    else if (network && junctions.length === 2 && parachainOf(second) !== undefined)
      peerKey = `${network}:${parachainOf(second)}`;
  }

  return { peerKey, peerLabel };
};
