import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Link } from 'lucide-react';
import { Fragment, useState } from 'react';
import { REMOVED_VERSION } from '../lib/aggregate';
import { chainHref } from '../lib/chainLink';
import type { Fix, KeptRecord } from '../lib/fixes';
import { STATUS_PRIORITY, type Row } from '../lib/rows';
import { TARGET_RELEASE } from '../lib/sdk';
import { ChainDetail } from './ChainDetail';
import type { Governance } from './GovernanceCall';
import { StatusBadge } from './StatusBadge';

type SortKey = 'status' | 'chain' | 'version' | 'peers' | 'sdk';

const SORTERS: Record<SortKey, (row: Row) => number | string> = {
  status: (row) => STATUS_PRIORITY[row.status],
  chain: (row) => row.chain.name.toLowerCase(),
  version: (row) => row.speakableVersion ?? 99,
  peers: (row) => (row.recordedByPeers.length ? Math.min(...row.recordedByPeers.map((record) => record.version)) : 99),
  sdk: (row) => -(row.releasesBehind ?? -1),
};

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'chain', label: 'Chain' },
  { key: 'version', label: 'Speaks' },
  { key: 'peers', label: 'Recorded by peers' },
  { key: 'sdk', label: 'SDK release' },
  { key: 'status', label: 'Status' },
  { key: null, label: 'Contact' },
];

const VersionCell = ({ row }: { row: Row }) => {
  if (row.speakableVersion === null) return <span className="text-tertiary">—</span>;
  const low = row.speakableVersion <= REMOVED_VERSION;
  const parts = [
    row.advertisedVersion !== null && `advertises v${row.advertisedVersion}`,
    row.maxInMetadata !== null && `runtime up to V${row.maxInMetadata}`,
    row.speakableSource === 'peers' && 'from peer records',
  ].filter(Boolean);
  return (
    <div>
      <span className={low ? 'text-error font-semibold' : 'text-primary font-medium'}>v{row.speakableVersion}</span>
      <p className="text-xs text-tertiary">{parts.join(' · ')}</p>
    </div>
  );
};

const PeersCell = ({ row }: { row: Row }) => {
  const versions = row.recordedByPeers.map((record) => record.version);
  if (!versions.length) return <span className="text-tertiary">—</span>;
  const lowest = Math.min(...versions);
  const highest = Math.max(...versions);
  const lowCount = versions.filter((version) => version <= REMOVED_VERSION).length;
  return (
    <div>
      <span className={lowest <= REMOVED_VERSION ? 'text-warning font-medium' : 'text-primary'}>
        {lowest === highest ? `v${lowest}` : `v${lowest}–v${highest}`}
      </span>
      <p className="text-xs text-tertiary">
        {versions.length} peer{versions.length === 1 ? '' : 's'}
        {lowCount ? ` · ${lowCount} at v${REMOVED_VERSION} or lower` : ''}
      </p>
    </div>
  );
};

const SdkCell = ({ row }: { row: Row }) => {
  if (!row.sdk) return <span className="text-tertiary">No repository</span>;
  if (!row.sdk.release) return <span className="text-tertiary">Unknown</span>;
  return (
    <div>
      <span className="text-primary font-medium">{row.sdk.release}</span>
      {!row.sdk.runtimeVerified && (
        <span className="text-tertiary" title="The repository's lockfile has no runtime crate matching this chain">
          {' '}
          (unconfirmed)
        </span>
      )}
      <p className="text-xs text-tertiary">
        {row.releasesBehind === null
          ? ''
          : row.releasesBehind === 0
            ? `On ${TARGET_RELEASE}`
            : row.sdk.release.startsWith('v')
              ? 'Pre-stable release'
              : `${row.releasesBehind} release${row.releasesBehind === 1 ? '' : 's'} before ${TARGET_RELEASE}`}
      </p>
    </div>
  );
};

export const ContactCell = ({ row }: { row: Row }) => (
  <div className="text-sm">
    {row.contact?.team && <p className="text-primary">{row.contact.team}</p>}
    {row.contact?.contact && <p className="text-secondary">{row.contact.contact}</p>}
    {row.chain.homepage && (
      <a
        className="text-link hover:text-link-hover transition-colors"
        href={row.chain.homepage}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {new URL(row.chain.homepage).hostname.replace(/^www\./, '')}
      </a>
    )}
  </div>
);

interface ChainTableProps {
  rows: Row[];
  fixes: Fix[];
  kept: KeptRecord[];
  governance: Governance;
  nameOf: (key: string | null) => string;
}

export const ChainTable = ({ rows, fixes, kept, governance, nameOf }: ChainTableProps) => {
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'status', ascending: true });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = [...rows].sort((a, b) => {
    const left = SORTERS[sort.key](a);
    const right = SORTERS[sort.key](b);
    const order = left < right ? -1 : left > right ? 1 : 0;
    // Ties fall back to relay then para ID so the order is stable while chains load.
    const fallback = a.chain.key.localeCompare(b.chain.key, undefined, { numeric: true });
    return (sort.ascending ? order : -order) || fallback;
  });

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="bg-surface-container rounded-container overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-divider text-left">
            <th className="w-10" aria-label="Expand" />
            {COLUMNS.map((column) => (
              <th key={column.label} className="px-4 py-3 font-medium text-secondary whitespace-nowrap">
                {column.key ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-secondary-hover transition-colors cursor-pointer"
                    onClick={() =>
                      setSort((current) => ({
                        key: column.key!,
                        ascending: current.key === column.key ? !current.ascending : true,
                      }))
                    }
                  >
                    {column.label}
                    {sort.key === column.key &&
                      (sort.ascending ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />)}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const isOpen = expanded.has(row.chain.key);
            return (
              <Fragment key={row.chain.key}>
                <tr
                  className={`border-b border-divider align-top cursor-pointer transition-colors hover:bg-selection-container-hover ${
                    row.chain.activity === 'stalled' ? 'opacity-70' : ''
                  }`}
                  onClick={() => toggle(row.chain.key)}
                >
                  <td className="pl-4 py-3">
                    <button
                      type="button"
                      className="text-tertiary hover:text-secondary transition-colors cursor-pointer"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${row.chain.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(row.chain.key);
                      }}
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-primary flex items-center gap-1.5">
                      {row.chain.name}
                      <a
                        className="text-tertiary hover:text-secondary transition-colors"
                        href={chainHref(row.chain.key)}
                        target="_blank"
                        rel="noopener"
                        title="Link to this chain's page"
                        aria-label={`Open ${row.chain.name} on its own page`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Link className="w-3.5 h-3.5" aria-hidden />
                      </a>
                    </p>
                    <p className="text-xs text-tertiary">
                      {row.chain.relay[0].toUpperCase() + row.chain.relay.slice(1)}
                      {row.chain.paraId !== null && ` · ${row.chain.paraId}`}
                      {row.chain.activity === 'stalled' && ` · no blocks for ${row.chain.daysSinceLastBlock} days`}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <VersionCell row={row} />
                  </td>
                  <td className="px-4 py-3">
                    <PeersCell row={row} />
                  </td>
                  <td className="px-4 py-3">
                    <SdkCell row={row} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                    <p className="text-xs text-tertiary mt-0.5 max-w-64">{row.reason}</p>
                  </td>
                  <td className="px-4 py-3">
                    <ContactCell row={row} />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-divider">
                    <td colSpan={COLUMNS.length + 1} className="p-0">
                      <ChainDetail row={row} fixes={fixes} kept={kept} governance={governance} nameOf={nameOf} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
