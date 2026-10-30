import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, History, TriangleAlert } from 'lucide-react';
import type { ChainStatus } from '../lib/types';

export const STATUS_LABELS: Record<ChainStatus, string> = {
  blocker: 'Blocker',
  'stale-peers': 'Recorded at v3',
  'holds-stale-records': 'Holds v3 records',
  unreachable: 'Unreachable',
  pending: 'Checking',
  ready: 'Ready',
};

const STYLES: Record<ChainStatus, { icon: typeof CircleAlert; className: string }> = {
  blocker: { icon: CircleAlert, className: 'text-error' },
  'stale-peers': { icon: TriangleAlert, className: 'text-warning' },
  'holds-stale-records': { icon: History, className: 'text-warning' },
  unreachable: { icon: CircleHelp, className: 'text-tertiary' },
  pending: { icon: CircleDashed, className: 'text-tertiary' },
  ready: { icon: CircleCheck, className: 'text-success' },
};

/** Status is never conveyed by color alone: every badge has an icon and a label. */
export const StatusBadge = ({ status }: { status: ChainStatus }) => {
  const { icon: Icon, className } = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap ${className}`}>
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      <span>{STATUS_LABELS[status]}</span>
    </span>
  );
};
