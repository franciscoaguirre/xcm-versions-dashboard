import knownChains from '../data/chains.json';
import { REMOVED_VERSION } from './aggregate';
import type { ChainKey, ChainReport, VersionRecord } from './types';

/** `stale-record`: a `SupportedVersion` entry holding an upgraded peer at v3 or lower. */
export type FixKind = 'stale-record' | 'fallback-version';

export interface Fix {
  /** The chain whose governance has to make the call. */
  holderKey: ChainKey;
  /** The peer the stale record is about, or `null` for the fallback version. */
  peerKey: ChainKey | null;
  /** The version currently on record (or the fallback version). */
  recorded: number;
  /** The version to set: what the peer speaks, or the new fallback version. */
  newVersion: number;
  kind: FixKind;
  /** pallet-xcm call to submit from the chain's admin origin, as polkadot.js / PAPI name it. */
  call: string;
  /** The call's arguments, in polkadot.js JSON. */
  argument: string;
  /** The peer's location from the holder's point of view, or `null` for the fallback version. */
  location: ParsedLocation | null;
}

export type ParsedJunction = { Parachain: number } | { GlobalConsensus: string };

export interface ParsedLocation {
  parents: number;
  junctions: ParsedJunction[];
}

/** The fallback version to raise to: the lowest one that survives the removal of v3. */
export const MINIMUM_SAFE_VERSION = REMOVED_VERSION + 1;

/** `../Parachain(1000)` -> `{ parents: 1, junctions: [{ Parachain: 1000 }] }`, from a `VersionRecord` label. */
export const parseLocationLabel = (label: string): ParsedLocation => {
  const parts = label.split('/');
  const parents = parts.filter((part) => part === '..').length;
  const junctions = parts
    .filter((part) => part !== '..' && part !== 'Here')
    .map((part): ParsedJunction => {
      const [, kind, value] = /^(\w+)\((\w+)\)$/.exec(part) ?? [];
      if (kind === 'Parachain') return { Parachain: Number(value) };
      if (kind === 'GlobalConsensus') return { GlobalConsensus: value };
      throw new Error(`Unsupported junction in location ${label}: ${part}`);
    });
  return { parents, junctions };
};

/** `../Parachain(1000)` -> `{ parents: 1, interior: { X1: [{ Parachain: 1000 }] } }` */
export const locationLiteral = (label: string) => {
  const { parents, junctions } = parseLocationLabel(label);
  const literals = junctions.map((junction) =>
    'Parachain' in junction ? `{ Parachain: ${junction.Parachain} }` : `{ GlobalConsensus: '${junction.GlobalConsensus}' }`,
  );
  const interior = literals.length ? `{ X${literals.length}: [${literals.join(', ')}] }` : 'Here';
  return `{ parents: ${parents}, interior: ${interior} }`;
};

/** `XcmPallet` -> `xcmPallet`, the name polkadot.js and PAPI use for the pallet's calls. */
const callPrefix = (report: ChainReport) => {
  const pallet = report.snapshot?.palletName ?? 'PolkadotXcm';
  return pallet[0].toLowerCase() + pallet.slice(1);
};

/** Every version setting that would still make a chain send XCM v3 or lower, with the call that fixes it. */
export const recordsToFix = (reports: ChainReport[]): Fix[] => {
  const byKey = new Map(reports.map((report) => [report.chain.key, report]));
  const fixes: Fix[] = [];

  for (const holder of reports) {
    const prefix = callPrefix(holder);

    for (const record of holder.staleRecords) {
      const peer = byKey.get(record.peerKey!);
      if (!peer) continue;
      // Stale records only exist for peers whose version is known to be above v3.
      const newVersion = peer.speakableVersion ?? MINIMUM_SAFE_VERSION;
      fixes.push({
        holderKey: holder.chain.key,
        peerKey: peer.chain.key,
        recorded: record.version,
        newVersion,
        kind: 'stale-record',
        call: `${prefix}.forceXcmVersion`,
        argument: `${locationLiteral(record.peerLabel)}, ${newVersion}`,
        location: parseLocationLabel(record.peerLabel),
      });
    }

    const fallback = holder.snapshot?.state === 'ok' ? holder.snapshot.safeVersion : undefined;
    if (fallback !== undefined && fallback <= REMOVED_VERSION) {
      fixes.push({
        holderKey: holder.chain.key,
        peerKey: null,
        recorded: fallback,
        newVersion: MINIMUM_SAFE_VERSION,
        kind: 'fallback-version',
        call: `${prefix}.forceDefaultXcmVersion`,
        argument: `Some(${MINIMUM_SAFE_VERSION})`,
        location: null,
      });
    }
  }
  return fixes;
};

/** A record at v3 or lower that no call should change, and why. */
export interface KeptRecord {
  holderKey: ChainKey;
  record: VersionRecord;
  /** For peers that are no longer live, their name from the endpoint list, if it has one. */
  retiredName?: string;
  reason: string;
}

const knownNames = new Map((knownChains as { key: string; name: string }[]).map((chain) => [chain.key, chain.name]));

const peerReason = (peer: ChainReport): string => {
  const version = peer.speakableVersion;
  if (version === null) return "Unreachable, and no peer records a version for it, so it's unknown what it speaks";
  const why =
    peer.speakableSource === 'metadata'
      ? `Its runtime only speaks up to v${peer.maxInMetadata}`
      : peer.speakableSource === 'advertised'
        ? `It advertises v${peer.advertisedVersion}`
        : `Unreachable, and every peer records it at v${version} or lower`;
  const stalled = peer.chain.activity === 'stalled' ? ` It has produced no blocks for ${peer.chain.daysSinceLastBlock} days.` : '';
  return `${why}, so setting it higher would break messages that work today. The chain has to upgrade first.${stalled}`;
};

/**
 * Every record at v3 or lower that `recordsToFix` leaves alone: its peer really speaks v3 or lower,
 * its version is unknown, or the chain is no longer running.
 */
export const recordsLeftAsIs = (reports: ChainReport[]): KeptRecord[] => {
  const byKey = new Map(reports.map((report) => [report.chain.key, report]));
  return reports.flatMap((holder) =>
    (holder.snapshot?.supported ?? [])
      .filter((record) => record.version <= REMOVED_VERSION && !holder.staleRecords.includes(record))
      .map((record): KeptRecord => {
        const peer = record.peerKey ? byKey.get(record.peerKey) : undefined;
        const reason = !record.peerKey
          ? "Not a chain this dashboard can identify, so there's no version to compare it with"
          : !peer
            ? 'Its relay has included no block from it in the last year, so the chain is no longer running and messages to it fail anyway'
            : peerReason(peer);
        const retiredName = record.peerKey && !peer ? knownNames.get(record.peerKey) : undefined;
        return { holderKey: holder.chain.key, record, retiredName, reason };
      }),
  );
};
