export type RelayName = 'polkadot' | 'kusama';

/** `polkadot:relay`, `kusama:2023`, ... */
export type ChainKey = string;

export interface ChainInfo {
  key: ChainKey;
  relay: RelayName;
  /** `null` for the relay chain itself. */
  paraId: number | null;
  name: string;
  homepage?: string;
  providers: string[];
  /** Relays are always active; parachains are classified from their last included block. */
  activity?: 'active' | 'stalled';
  daysSinceLastBlock?: number;
}

/** One entry of a chain's `SupportedVersion` or `VersionNotifyTargets` map. */
export interface VersionRecord {
  /** The chain the location resolves to, or `null` for non-chain locations. */
  peerKey: ChainKey | null;
  /** Human-readable form of the location, e.g. `../Parachain(2034)`. */
  peerLabel: string;
  version: number;
  /** XCM version of the storage key's location encoding. */
  keyVersion?: number;
}

export type SnapshotState = 'ok' | 'unreachable' | 'no-xcm-pallet';

export interface ChainSnapshot {
  key: ChainKey;
  state: SnapshotState;
  error?: string;
  endpoint?: string;
  specName?: string;
  specVersion?: number;
  palletName?: string;
  /** Highest `VersionedXcm` variant in the runtime metadata. */
  maxInMetadata?: number;
  safeVersion?: number;
  /** From `VersionNotifyTargets`: the version this chain advertised to each subscriber. */
  advertised: VersionRecord[];
  /** From `SupportedVersion`: the version this chain believes each peer supports. */
  supported: VersionRecord[];
}

export type ChainStatus =
  | 'blocker'
  | 'stale-peers'
  | 'holds-stale-records'
  | 'ready'
  | 'unreachable'
  | 'pending';

export interface PeerRecord {
  /** The chain holding the record. */
  holderKey: ChainKey;
  version: number;
}

export interface ChainReport {
  chain: ChainInfo;
  snapshot?: ChainSnapshot;
  /** Highest version this chain advertises to its subscribers. */
  advertisedVersion: number | null;
  maxInMetadata: number | null;
  /** The version this chain can speak at most, from the best available source. */
  speakableVersion: number | null;
  speakableSource: 'metadata' | 'advertised' | 'peers' | null;
  /** What every other chain has recorded for this chain. */
  recordedByPeers: PeerRecord[];
  /** Entries in this chain's own map holding an upgraded peer at v3 or lower. */
  staleRecords: VersionRecord[];
  status: ChainStatus;
  reason: string;
}
