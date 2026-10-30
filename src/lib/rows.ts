import contacts from '../data/contacts.json';
import sdkVersions from '../data/sdk-versions.json';
import type { ChainReport, ChainStatus } from './types';
import { releasesBehind } from './sdk';

export interface Contact {
  team?: string;
  contact?: string;
  notes?: string;
}

export interface SdkVersion {
  repo: string;
  lockPath?: string;
  commit: string | null;
  commitDate?: string | null;
  runtimeVerified?: boolean;
  release?: string | null;
  oldestRelease?: string | null;
  crateVersions?: string[];
  note?: string;
  error?: string;
  fetchedAt?: string;
}

export interface Row extends ChainReport {
  contact?: Contact;
  sdk?: SdkVersion;
  releasesBehind: number | null;
}

/** Order rows by urgency: chains that would be isolated come first. */
export const STATUS_PRIORITY: Record<ChainStatus, number> = {
  blocker: 0,
  'stale-peers': 1,
  'holds-stale-records': 2,
  unreachable: 3,
  pending: 4,
  ready: 5,
};

export const toRows = (reports: ChainReport[]): Row[] =>
  reports.map((report) => {
    const sdk = (sdkVersions as Record<string, SdkVersion>)[report.chain.key];
    return {
      ...report,
      contact: (contacts as Record<string, Contact>)[report.chain.key],
      sdk,
      releasesBehind: releasesBehind(sdk?.release),
    };
  });

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (rows: Row[]) => {
  const header = [
    'relay',
    'para_id',
    'chain',
    'activity',
    'status',
    'reason',
    'speakable_version',
    'advertised_version',
    'max_in_metadata',
    'lowest_recorded_by_peers',
    'peers_recording_v3_or_lower',
    'stale_records_held',
    'sdk_release',
    'releases_behind_stable2612',
    'repo',
    'homepage',
    'team',
    'contact',
    'notes',
  ];
  const lines = rows.map((row) =>
    [
      row.chain.relay,
      row.chain.paraId ?? 'relay',
      row.chain.name,
      row.chain.activity,
      row.status,
      row.reason,
      row.speakableVersion,
      row.advertisedVersion,
      row.maxInMetadata,
      row.recordedByPeers.length ? Math.min(...row.recordedByPeers.map((record) => record.version)) : '',
      row.recordedByPeers.filter((record) => record.version <= 3).map((record) => record.holderKey).join(' '),
      row.staleRecords.map((record) => record.peerKey).join(' '),
      row.sdk?.release,
      row.releasesBehind,
      row.sdk?.repo,
      row.chain.homepage,
      row.contact?.team,
      row.contact?.contact,
      row.contact?.notes,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
};
