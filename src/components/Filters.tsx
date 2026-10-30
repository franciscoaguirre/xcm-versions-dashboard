import { Search } from 'lucide-react';
import type { ChainStatus, RelayName } from '../lib/types';
import { STATUS_LABELS } from './StatusBadge';

export interface FilterState {
  relay: RelayName | 'all';
  status: ChainStatus | 'all';
  includeStalled: boolean;
  search: string;
}

interface FiltersProps {
  value: FilterState;
  onChange: (value: FilterState) => void;
  stalledCount: number;
}

const segmentClass = (active: boolean) =>
  `px-3 py-1.5 rounded-small text-sm font-medium transition-colors cursor-pointer ${
    active ? 'bg-action-primary text-primary-inverted' : 'text-secondary hover:bg-action-secondary-hover'
  }`;

export const Filters = ({ value, onChange, stalledCount }: FiltersProps) => {
  const update = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 bg-action-secondary rounded-nested p-1" role="group" aria-label="Relay">
        {(['all', 'polkadot', 'kusama'] as const).map((relay) => (
          <button
            key={relay}
            type="button"
            className={segmentClass(value.relay === relay)}
            aria-pressed={value.relay === relay}
            onClick={() => update({ relay })}
          >
            {relay === 'all' ? 'Both relays' : relay[0].toUpperCase() + relay.slice(1)}
          </button>
        ))}
      </div>

      <select
        className="bg-surface-container border rounded-nested px-3 py-2 text-sm text-primary cursor-pointer"
        value={value.status}
        aria-label="Status"
        onChange={(event) => update({ status: event.target.value as FilterState['status'] })}
      >
        <option value="all">All statuses</option>
        {(Object.keys(STATUS_LABELS) as ChainStatus[])
          .filter((status) => status !== 'pending')
          .map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
      </select>

      <label className="inline-flex items-center gap-2 text-sm text-secondary cursor-pointer">
        <input
          type="checkbox"
          className="cursor-pointer"
          checked={value.includeStalled}
          onChange={(event) => update({ includeStalled: event.target.checked })}
        />
        Include {stalledCount} stalled chains
      </label>

      <div className="relative ml-auto">
        <Search className="w-4 h-4 text-tertiary absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
        <input
          type="search"
          placeholder="Search chains"
          className="bg-surface-container border rounded-nested pl-9 pr-3 py-2 text-sm text-primary cursor-text w-56"
          value={value.search}
          onChange={(event) => update({ search: event.target.value })}
        />
      </div>
    </div>
  );
};
