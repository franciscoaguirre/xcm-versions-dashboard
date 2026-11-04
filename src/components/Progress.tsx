import { RefreshCw } from 'lucide-react';
import type { useChainData } from '../lib/useChainData';

type ChainData = ReturnType<typeof useChainData>;

export const RefreshButton = ({ data }: { data: ChainData }) => (
  <button
    type="button"
    className="inline-flex items-center gap-2 bg-action-primary text-primary-inverted font-medium text-sm px-4 py-2 rounded-small hover:bg-action-primary-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-action-primary"
    disabled={data.isBusy}
    onClick={data.run}
  >
    <RefreshCw className={`w-5 h-5 ${data.isBusy ? 'animate-spin' : ''}`} aria-hidden />
    Refresh
  </button>
);

export const ProgressLine = ({ data }: { data: ChainData }) => {
  const { phase, snapshots, chains, checkedAt, error } = data;
  return (
    <p className="text-sm text-secondary" aria-live="polite">
      {phase === 'resolving' && 'Asking both relay chains which parachains are producing blocks…'}
      {phase === 'collecting' && `Reading XCM storage: ${snapshots.length} of ${chains.length} chains checked`}
      {phase === 'done' && checkedAt && `Checked ${chains.length} chains at ${checkedAt.toLocaleTimeString()}.`}
      {phase === 'failed' && <span className="text-error">Couldn't reach the relay chains: {error}</span>}
    </p>
  );
};
