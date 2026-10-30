import { REMOVED_VERSION } from './aggregate';
import type { ChainKey, ChainReport } from './types';

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
}

/** The fallback version to raise to: the lowest one that survives the removal of v3. */
export const MINIMUM_SAFE_VERSION = REMOVED_VERSION + 1;

/** `../Parachain(1000)` -> `{ parents: 1, interior: { X1: [{ Parachain: 1000 }] } }` */
export const locationLiteral = (label: string) => {
  const parts = label.split('/');
  const parents = parts.filter((part) => part === '..').length;
  const junctions = parts
    .filter((part) => part !== '..' && part !== 'Here')
    .map((part) => {
      const [, kind, value] = /^(\w+)\((\w+)\)$/.exec(part) ?? [];
      if (kind === 'Parachain') return `{ Parachain: ${value} }`;
      return kind ? `{ ${kind}: '${value}' }` : part;
    });
  const interior = junctions.length ? `{ X${junctions.length}: [${junctions.join(', ')}] }` : 'Here';
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
      });
    }
  }
  return fixes;
};
