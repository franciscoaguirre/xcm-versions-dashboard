import { Download } from 'lucide-react';
import { useState } from 'react';
import { ChainTable } from './components/ChainTable';
import { GuideAnchor } from './components/GuideAnchor';
import { Filters, type FilterState } from './components/Filters';
import { ProgressLine, RefreshButton } from './components/Progress';
import { SummaryTiles } from './components/SummaryTiles';
import { toCsv } from './lib/rows';
import { TARGET_RELEASE } from './lib/sdk';
import { useChainData } from './lib/useChainData';

const downloadCsv = (content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `xcm-versions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export const App = () => {
  const data = useChainData();
  const { rows, fixes, kept, governance, nameOf, isBusy } = data;
  const [filters, setFilters] = useState<FilterState>({
    relay: 'all',
    status: 'all',
    includeStalled: false,
    search: '',
  });

  const inScope = rows.filter(
    (row) =>
      (filters.relay === 'all' || row.chain.relay === filters.relay) &&
      (filters.includeStalled || row.chain.activity === 'active'),
  );
  const search = filters.search.trim().toLowerCase();
  const visible = inScope.filter(
    (row) =>
      (filters.status === 'all' || row.status === filters.status) &&
      (!search ||
        row.chain.name.toLowerCase().includes(search) ||
        String(row.chain.paraId).includes(search) ||
        row.snapshot?.specName?.toLowerCase().includes(search)),
  );
  const stalledCount = rows.filter(
    (row) => row.chain.activity === 'stalled' && (filters.relay === 'all' || row.chain.relay === filters.relay),
  ).length;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-tight text-primary">XCM versions</h1>
          <p className="text-secondary mt-2 max-w-2xl">
            XCM v3 is removed in polkadot-sdk {TARGET_RELEASE}. These are every live Polkadot and Kusama chain, the XCM
            version each one speaks, and what its peers have recorded for it. Blockers are the teams to contact first.
            Expand a chain to see what its team needs to do.
          </p>
          <p className="text-sm text-secondary mt-2">
            Guides: <GuideAnchor link={{ slug: 'fixing-xcm-version-records' }} /> ·{' '}
            <GuideAnchor link={{ slug: 'migrating-xcm-v3-to-v4' }} />
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-action-secondary text-primary font-medium text-sm px-4 py-2 rounded-small hover:bg-action-secondary-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-action-secondary"
            disabled={!visible.length}
            onClick={() => downloadCsv(toCsv(visible))}
          >
            <Download className="w-5 h-5" aria-hidden />
            Export CSV
          </button>
          <RefreshButton data={data} />
        </div>
      </header>

      <ProgressLine data={data} />

      <SummaryTiles rows={inScope} />
      <Filters value={filters} onChange={setFilters} stalledCount={stalledCount} />
      {visible.length ? (
        <ChainTable rows={visible} fixes={fixes} kept={kept} governance={governance} nameOf={nameOf} />
      ) : (
        <div className="bg-surface-container rounded-container p-12 text-center text-secondary">
          {isBusy ? 'Loading chains…' : 'No chains match these filters.'}
        </div>
      )}
    </main>
  );
};
