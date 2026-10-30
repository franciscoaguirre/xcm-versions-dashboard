import { Download, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChainTable } from './components/ChainTable';
import { GuideAnchor } from './components/GuideAnchor';
import { Filters, type FilterState } from './components/Filters';
import { RecordsToFix } from './components/RecordsToFix';
import { SummaryTiles } from './components/SummaryTiles';
import { aggregate } from './lib/aggregate';
import { recordsToFix } from './lib/fixes';
import { toCsv, toRows } from './lib/rows';
import { collectAll, resolveLiveChains } from './lib/run';
import { TARGET_RELEASE } from './lib/sdk';
import type { ChainInfo, ChainSnapshot } from './lib/types';

type Phase = 'resolving' | 'collecting' | 'done' | 'failed';

const downloadCsv = (content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `xcm-versions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export const App = () => {
  const [phase, setPhase] = useState<Phase>('resolving');
  const [error, setError] = useState<string>();
  const [chains, setChains] = useState<ChainInfo[]>([]);
  const [snapshots, setSnapshots] = useState<ChainSnapshot[]>([]);
  const [checkedAt, setCheckedAt] = useState<Date>();
  const [filters, setFilters] = useState<FilterState>({
    relay: 'all',
    status: 'all',
    includeStalled: false,
    search: '',
  });
  const runId = useRef(0);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setPhase('resolving');
    setError(undefined);
    setSnapshots([]);
    try {
      const live = await resolveLiveChains();
      if (id !== runId.current) return;
      setChains(live);
      setPhase('collecting');
      await collectAll(live, (snapshot) => {
        if (id === runId.current) setSnapshots((current) => [...current, snapshot]);
      });
      if (id !== runId.current) return;
      setCheckedAt(new Date());
      setPhase('done');
    } catch (caught) {
      if (id !== runId.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('failed');
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const rows = useMemo(() => toRows(aggregate(chains, snapshots)), [chains, snapshots]);
  const fixes = useMemo(() => recordsToFix(rows), [rows]);
  const nameOf = useCallback(
    (key: string | null) => {
      const chain = chains.find((item) => item.key === key);
      if (!chain) return key ?? 'Unknown';
      const relay = chain.relay[0].toUpperCase() + chain.relay.slice(1);
      return chain.paraId === null ? chain.name : `${chain.name} (${relay} ${chain.paraId})`;
    },
    [chains],
  );

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
  const visibleFixes = fixes.filter((fix) => {
    const holder = rows.find((row) => row.chain.key === fix.holderKey)?.chain;
    return (
      !!holder &&
      (filters.relay === 'all' || holder.relay === filters.relay) &&
      (filters.includeStalled || holder.activity === 'active')
    );
  });
  const stalledCount = rows.filter(
    (row) => row.chain.activity === 'stalled' && (filters.relay === 'all' || row.chain.relay === filters.relay),
  ).length;
  const isBusy = phase === 'resolving' || phase === 'collecting';

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
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-action-primary"
            disabled={isBusy}
            onClick={run}
          >
            <RefreshCw className={`w-5 h-5 ${isBusy ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      <p className="text-sm text-secondary" aria-live="polite">
        {phase === 'resolving' && 'Asking both relay chains which parachains are producing blocks…'}
        {phase === 'collecting' && `Reading XCM storage: ${snapshots.length} of ${chains.length} chains checked`}
        {phase === 'done' && checkedAt && `Checked ${chains.length} chains at ${checkedAt.toLocaleTimeString()}.`}
        {phase === 'failed' && <span className="text-error">Couldn't reach the relay chains: {error}</span>}
      </p>

      <SummaryTiles rows={inScope} />
      <Filters value={filters} onChange={setFilters} stalledCount={stalledCount} />
      {visible.length ? (
        <ChainTable rows={visible} fixes={fixes} nameOf={nameOf} />
      ) : (
        <div className="bg-surface-container rounded-container p-12 text-center text-secondary">
          {isBusy ? 'Loading chains…' : 'No chains match these filters.'}
        </div>
      )}
      {phase === 'done' && <RecordsToFix fixes={visibleFixes} nameOf={nameOf} />}
    </main>
  );
};
