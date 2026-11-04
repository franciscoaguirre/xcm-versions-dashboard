import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import type { ChainKey } from '../lib/types';
import { useChainData } from '../lib/useChainData';
import { ChainDetail } from './ChainDetail';
import { ContactCell } from './ChainTable';
import { ProgressLine, RefreshButton } from './Progress';
import { StatusBadge } from './StatusBadge';

/**
 * One chain's details on their own, served at `?chain=<key>` so a team can be sent a single link.
 * Every chain is still read: its status and the records its peers hold for it come from their storage.
 */
export const ChainPage = ({ chainKey }: { chainKey: ChainKey }) => {
  const data = useChainData();
  const { phase, rows, fixes, kept, governance, nameOf } = data;
  const row = rows.find((item) => item.chain.key === chainKey);
  const name = row?.chain.name;

  useEffect(() => {
    document.title = `${name ?? chainKey} · XCM versions`;
  }, [name, chainKey]);

  const backLink = (
    <a
      href="./"
      className="inline-flex items-center gap-2 self-start text-sm font-medium text-secondary hover:text-secondary-hover transition-colors"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden />
      XCM versions dashboard
    </a>
  );

  // The live chains are known once resolving ends; a missing key is a typo or a retired para.
  if (!row && phase !== 'resolving') {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
        {backLink}
        <div className="bg-surface-container rounded-container p-12 text-center text-secondary">
          {phase === 'failed' ? (
            <ProgressLine data={data} />
          ) : (
            <>
              No live chain with key <code className="font-mono text-primary">{chainKey}</code>. Keys look like{' '}
              <code className="font-mono">polkadot:2000</code> or <code className="font-mono">kusama:relay</code>.
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
      {backLink}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-tight text-primary">{name ?? chainKey}</h1>
          {row && (
            <p className="text-secondary mt-2">
              {row.chain.relay[0].toUpperCase() + row.chain.relay.slice(1)}
              {row.chain.paraId === null ? ' relay chain' : ` · para ${row.chain.paraId}`}
              {row.chain.activity === 'stalled' && ` · no blocks for ${row.chain.daysSinceLastBlock} days`}
            </p>
          )}
        </div>
        <RefreshButton data={data} />
      </header>

      <ProgressLine data={data} />

      {row && phase === 'done' ? (
        <>
          <div className="bg-surface-container rounded-container p-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <StatusBadge status={row.status} />
              <p className="text-sm text-secondary mt-1">{row.reason}</p>
            </div>
            <ContactCell row={row} />
          </div>
          <div className="bg-surface-container rounded-container overflow-hidden">
            <ChainDetail row={row} fixes={fixes} kept={kept} governance={governance} nameOf={nameOf} />
          </div>
        </>
      ) : (
        <div className="bg-surface-container rounded-container p-12 text-center text-secondary">
          Reading every chain first: what peers have recorded for this one is in their storage.
        </div>
      )}
    </main>
  );
};
