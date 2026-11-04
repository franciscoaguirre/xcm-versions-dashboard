/**
 * Runs the same collection as the dashboard and writes the shared dashboard's data files:
 *   exports/chains.json           one row per chain, with display-ready columns
 *   exports/version-records.json  every SupportedVersion entry across all chains
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { REMOVED_VERSION, aggregate } from '../src/lib/aggregate';
import { toRows } from '../src/lib/rows';
import { collectAll, resolveLiveChains } from '../src/lib/run';
import { STATUS_PRIORITY } from '../src/lib/rows';
import type { ChainStatus } from '../src/lib/types';

const STATUS_LABELS: Record<ChainStatus, string> = {
  blocker: 'Blocker',
  'stale-peers': 'Recorded at v3',
  'holds-stale-records': 'Holds v3 records',
  unreachable: 'Unreachable',
  pending: 'Not checked',
  ready: 'Ready',
};

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1);
const versionRange = (versions: number[]) => {
  if (!versions.length) return '';
  const lowest = Math.min(...versions);
  const highest = Math.max(...versions);
  return lowest === highest ? `v${lowest}` : `v${lowest}–v${highest}`;
};

const chains = await resolveLiveChains();
console.log(`Checking ${chains.length} chains`);
const snapshots = await collectAll(chains, (snapshot, chain) => console.log(`${chain.name}: ${snapshot.state}`));
const checkedAt = new Date().toISOString();
const rows = toRows(aggregate(chains, snapshots));
const byKey = new Map(rows.map((row) => [row.chain.key, row]));
const nameOf = (key: string | null, fallback: string) => {
  const row = key ? byKey.get(key) : undefined;
  if (!row) return fallback;
  return row.chain.paraId === null ? row.chain.name : `${row.chain.name} (${capitalize(row.chain.relay)} ${row.chain.paraId})`;
};

const chainRows = rows.map((row) => {
  const peerVersions = row.recordedByPeers.map((record) => record.version);
  const homepageHost = row.chain.homepage ? new URL(row.chain.homepage).hostname.replace(/^www\./, '') : '';
  return {
    key: row.chain.key,
    name: row.chain.name,
    relay: capitalize(row.chain.relay),
    para_id: row.chain.paraId,
    activity: row.chain.activity ?? 'active',
    days_since_last_block: row.chain.daysSinceLastBlock ?? 0,
    status: row.status,
    status_label: STATUS_LABELS[row.status],
    status_rank: STATUS_PRIORITY[row.status],
    reason: row.reason,
    speaks: row.speakableVersion === null ? '' : `v${row.speakableVersion}`,
    speaks_version: row.speakableVersion,
    speaks_source: row.speakableSource ?? '',
    advertised_version: row.advertisedVersion,
    max_in_metadata: row.maxInMetadata,
    peer_records: versionRange(peerVersions),
    lowest_peer_record: peerVersions.length ? Math.min(...peerVersions) : null,
    peers_recording: peerVersions.length,
    peers_at_v3_or_lower: peerVersions.filter((version) => version <= REMOVED_VERSION).length,
    stale_records_held: row.staleRecords.length,
    v3_keyed_entries: row.snapshot?.legacyKeyed?.length ?? 0,
    sdk_release: row.sdk?.release ?? '',
    releases_behind_stable2612: row.releasesBehind,
    sdk_repo: row.sdk?.repo ?? '',
    sdk_commit: row.sdk?.commit ?? '',
    sdk_confirmed: row.sdk?.runtimeVerified ?? false,
    spec: row.snapshot?.specName ? `${row.snapshot.specName} v${row.snapshot.specVersion}` : '',
    xcm_pallet: row.snapshot?.palletName ?? '',
    safe_xcm_version: row.snapshot?.safeVersion ?? null,
    rpc: row.snapshot?.endpoint ?? '',
    homepage: row.chain.homepage ?? '',
    contact: row.contact?.team || row.contact?.contact || homepageHost,
    contact_notes: row.contact?.notes ?? '',
    checked_at: checkedAt,
  };
});

const recordRows = rows.flatMap((row) =>
  (row.snapshot?.supported ?? []).map((record) => {
    const peer = record.peerKey ? byKey.get(record.peerKey) : undefined;
    // What the peer itself last advertised to this holder (its VersionNotifyTargets entry).
    const advertisedToHolder = (peer?.snapshot?.advertised ?? [])
      .filter((advertised) => advertised.peerKey === row.chain.key)
      .map((advertised) => advertised.version);
    return {
      holder_key: row.chain.key,
      holder: nameOf(row.chain.key, row.chain.key),
      peer_key: record.peerKey ?? record.peerLabel,
      peer: nameOf(record.peerKey, record.peerLabel),
      location: record.peerLabel,
      version: record.version,
      recorded: `v${record.version}`,
      peer_speaks: peer?.speakableVersion ?? null,
      peer_upgraded: row.staleRecords.includes(record),
      peer_reachable: peer?.snapshot?.state === 'ok',
      advertised_to_holder: advertisedToHolder.length ? Math.max(...advertisedToHolder) : null,
    };
  }),
);

const directory = new URL('../exports/', import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(new URL('chains.json', directory), JSON.stringify(chainRows, null, 2));
writeFileSync(new URL('version-records.json', directory), JSON.stringify(recordRows, null, 2));
const blockers = chainRows.filter((row) => row.status === 'blocker');
console.log(`Wrote ${chainRows.length} chains and ${recordRows.length} version records at ${checkedAt}`);
console.log(`Blockers: ${blockers.map((row) => `${row.name} (${row.activity})`).join(', ')}`);
process.exit(0);
