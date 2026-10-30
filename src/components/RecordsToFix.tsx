import { REMOVED_VERSION } from '../lib/aggregate';
import type { Fix } from '../lib/fixes';
import { GuideAnchor } from './GuideAnchor';

interface RecordsToFixProps {
  fixes: Fix[];
  nameOf: (key: string | null) => string;
}

export const RecordsToFix = ({ fixes, nameOf }: RecordsToFixProps) => {
  const sorted = [...fixes].sort(
    (a, b) =>
      a.holderKey.localeCompare(b.holderKey, undefined, { numeric: true }) ||
      Number(a.kind === 'fallback-version') - Number(b.kind === 'fallback-version') ||
      nameOf(a.peerKey).localeCompare(nameOf(b.peerKey)),
  );
  const chainCount = new Set(fixes.map((fix) => fix.holderKey)).size;

  return (
    <section className="bg-surface-container rounded-container p-6 flex flex-col gap-4" id="records-to-fix">
      <div>
        <h2 className="font-semibold text-lg leading-tight text-primary">Records to fix</h2>
        <p className="text-sm text-secondary mt-1 max-w-4xl">
          <span className="font-semibold text-primary tabular-nums">{fixes.length}</span> version settings on{' '}
          <span className="font-semibold text-primary tabular-nums">{chainCount}</span> chains still point at XCM v
          {REMOVED_VERSION} or lower. Once a chain upgrades to stable2612 it can no longer encode v{REMOVED_VERSION}, so
          messages that rely on these settings fail, even to peers that speak v5. Each fix is one call from that
          chain's admin origin, which is Root on most chains and usually means a governance referendum:{' '}
          <code className="font-mono text-xs">forceXcmVersion</code> sets a stale record to the version the peer
          speaks, and <code className="font-mono text-xs">forceDefaultXcmVersion</code> raises the fallback version.
          The <GuideAnchor link={{ slug: 'fixing-xcm-version-records' }}>version records guide</GuideAnchor> explains
          why, and how to batch the calls.
        </p>
      </div>

      {sorted.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-secondary">
                {['Chain to fix', 'Peer', 'Recorded as', 'Set to', 'Call', 'Arguments'].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium whitespace-nowrap">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((fix) => (
                <tr key={`${fix.holderKey}>${fix.peerKey ?? 'fallback'}`} className="border-b border-divider align-top">
                  <td className="px-3 py-2 text-primary font-medium">{nameOf(fix.holderKey)}</td>
                  <td className="px-3 py-2 text-primary">
                    {fix.peerKey ? nameOf(fix.peerKey) : 'Any destination without a record'}
                  </td>
                  <td className="px-3 py-2 text-error font-semibold">v{fix.recorded}</td>
                  <td className="px-3 py-2 text-primary">v{fix.newVersion}</td>
                  <td className="px-3 py-2 font-mono text-xs text-primary whitespace-nowrap">{fix.call}</td>
                  <td className="px-3 py-2 font-mono text-xs text-primary break-words select-all">{fix.argument}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-secondary">Nothing to fix for these filters.</p>
      )}
    </section>
  );
};
