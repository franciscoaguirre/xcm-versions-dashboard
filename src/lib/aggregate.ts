import type { ChainInfo, ChainKey, ChainReport, ChainSnapshot, PeerRecord, VersionRecord } from './types';

/** The version being removed. Anything at or below it is at risk. */
export const REMOVED_VERSION = 3;

const maxOf = (values: number[]) => (values.length ? Math.max(...values) : null);

const speakableOf = (
  snapshot: ChainSnapshot | undefined,
  recordedByPeers: PeerRecord[],
): Pick<ChainReport, 'speakableVersion' | 'speakableSource' | 'advertisedVersion' | 'maxInMetadata'> => {
  const advertisedVersion = maxOf(snapshot?.advertised.map((record) => record.version) ?? []);
  const maxInMetadata = snapshot?.maxInMetadata ?? null;

  // A chain speaks at most what its runtime can encode, and peers will only
  // send it what it advertised, so the lower of the two is what matters.
  const known = [maxInMetadata, advertisedVersion].filter((value): value is number => value !== null);
  if (known.length) {
    return {
      advertisedVersion,
      maxInMetadata,
      speakableVersion: Math.min(...known),
      speakableSource: maxInMetadata !== null && maxInMetadata <= (advertisedVersion ?? Infinity) ? 'metadata' : 'advertised',
    };
  }
  const fromPeers = maxOf(recordedByPeers.map((record) => record.version));
  return {
    advertisedVersion,
    maxInMetadata,
    speakableVersion: fromPeers,
    speakableSource: fromPeers === null ? null : 'peers',
  };
};

export const aggregate = (chains: ChainInfo[], snapshots: ChainSnapshot[]): ChainReport[] => {
  const snapshotByKey = new Map(snapshots.map((snapshot) => [snapshot.key, snapshot]));

  const recordedByPeersOf = new Map<ChainKey, PeerRecord[]>();
  for (const snapshot of snapshots) {
    for (const record of snapshot.supported) {
      if (!record.peerKey || record.peerKey === snapshot.key) continue;
      const records = recordedByPeersOf.get(record.peerKey) ?? [];
      records.push({ holderKey: snapshot.key, version: record.version });
      recordedByPeersOf.set(record.peerKey, records);
    }
  }

  const speakableByKey = new Map(
    chains.map((chain) => [
      chain.key,
      speakableOf(snapshotByKey.get(chain.key), recordedByPeersOf.get(chain.key) ?? []).speakableVersion,
    ]),
  );

  return chains.map((chain): ChainReport => {
    const snapshot = snapshotByKey.get(chain.key);
    const recordedByPeers = recordedByPeersOf.get(chain.key) ?? [];
    const speakable = speakableOf(snapshot, recordedByPeers);

    const staleRecords: VersionRecord[] = (snapshot?.supported ?? []).filter((record) => {
      if (!record.peerKey || record.version > REMOVED_VERSION) return false;
      const peerSpeakable = speakableByKey.get(record.peerKey);
      return peerSpeakable != null && peerSpeakable > REMOVED_VERSION;
    });

    const lowPeerRecords = recordedByPeers.filter((record) => record.version <= REMOVED_VERSION);
    const base = { chain, snapshot, ...speakable, recordedByPeers, staleRecords };

    if (!snapshot) return { ...base, status: 'pending', reason: 'Not queried yet' };

    if (snapshot.state !== 'ok') {
      if (speakable.speakableVersion !== null && speakable.speakableVersion <= REMOVED_VERSION) {
        const reason =
          speakable.speakableSource === 'peers'
            ? `Unreachable; every peer records it at v${speakable.speakableVersion} or lower`
            : `Runtime can only encode up to XCM v${speakable.speakableVersion} and has no XCM version storage`;
        return { ...base, status: 'blocker', reason };
      }
      const reason =
        snapshot.state === 'no-xcm-pallet' ? 'Runtime has no XCM pallet' : (snapshot.error ?? 'RPC did not respond');
      return { ...base, status: 'unreachable', reason };
    }

    if (speakable.speakableVersion !== null && speakable.speakableVersion <= REMOVED_VERSION) {
      const reason =
        speakable.speakableSource === 'metadata'
          ? `Runtime can only encode up to XCM v${speakable.maxInMetadata}`
          : `Advertises XCM v${speakable.advertisedVersion} to its peers`;
      return { ...base, status: 'blocker', reason };
    }
    if (lowPeerRecords.length) {
      return {
        ...base,
        status: 'stale-peers',
        reason: `${lowPeerRecords.length} peer(s) still record it at v${REMOVED_VERSION} or lower`,
      };
    }
    // Its own settings that would still make it send v3 or lower: the same ones recordsToFix fixes.
    const lowFallback = snapshot.safeVersion !== undefined && snapshot.safeVersion <= REMOVED_VERSION;
    if (staleRecords.length || lowFallback) {
      const parts = [
        staleRecords.length && `Records ${staleRecords.length} upgraded peer(s) at v${REMOVED_VERSION} or lower`,
        lowFallback && `fallback version (SafeXcmVersion) is v${snapshot.safeVersion}`,
      ].filter((part): part is string => Boolean(part));
      const reason = parts.join('; ');
      return { ...base, status: 'holds-stale-records', reason: reason[0].toUpperCase() + reason.slice(1) };
    }
    return {
      ...base,
      status: 'ready',
      reason: 'Speaks v4+, every record of it is v4+, and its fallback version is v4+ or unset',
    };
  });
};
