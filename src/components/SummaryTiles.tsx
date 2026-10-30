import type { Row } from '../lib/rows';

interface Tile {
  label: string;
  value: number;
  detail: string;
}

export const SummaryTiles = ({ rows }: { rows: Row[] }) => {
  const count = (predicate: (row: Row) => boolean) => rows.filter(predicate).length;
  const tiles: Tile[] = [
    {
      label: 'Blockers',
      value: count((row) => row.status === 'blocker'),
      detail: 'Can only speak XCM v3 or lower. They lose all XCM once v3 is removed.',
    },
    {
      label: 'Stale v3 records',
      value: count((row) => row.status === 'stale-peers' || row.status === 'holds-stale-records'),
      detail: 'Upgraded, but a version record somewhere still says v3.',
    },
    {
      label: 'Ready',
      value: count((row) => row.status === 'ready'),
      detail: 'Speaks v4 or higher, and every record of it agrees.',
    },
    {
      label: 'Unreachable',
      value: count((row) => row.status === 'unreachable'),
      detail: 'No working public RPC. Their status comes from peer records where possible.',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-surface-container rounded-container p-6">
          <p className="text-sm font-medium text-secondary">{tile.label}</p>
          <p className="text-4xl font-semibold leading-tight text-primary mt-2 tabular-nums">{tile.value}</p>
          <p className="text-sm text-tertiary mt-2">{tile.detail}</p>
        </div>
      ))}
    </div>
  );
};
