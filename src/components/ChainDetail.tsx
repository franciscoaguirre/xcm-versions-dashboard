import type { ReactNode } from 'react';
import { actionItems } from '../lib/actions';
import { REMOVED_VERSION } from '../lib/aggregate';
import type { Fix } from '../lib/fixes';
import type { Row } from '../lib/rows';
import { GuideAnchor } from './GuideAnchor';

interface ChainDetailProps {
  row: Row;
  fixes: Fix[];
  nameOf: (key: string | null) => string;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="bg-surface-container rounded-nested p-4">
    <h4 className="text-sm font-semibold leading-tight text-primary mb-3">{title}</h4>
    {children}
  </div>
);

const Fact = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex justify-between gap-4 text-sm py-1">
    <span className="text-secondary">{label}</span>
    <span className="text-primary text-right break-all">{value ?? '—'}</span>
  </div>
);

const versionClass = (version: number) => (version <= REMOVED_VERSION ? 'text-error font-semibold' : 'text-primary');

export const ChainDetail = ({ row, fixes, nameOf }: ChainDetailProps) => {
  const { snapshot, sdk } = row;
  const actions = actionItems(row, fixes, nameOf);
  const lowRecords = row.recordedByPeers.filter((record) => record.version <= REMOVED_VERSION);
  const supported = [...(snapshot?.supported ?? [])].sort((a, b) => a.version - b.version);

  return (
    <div className="grid gap-4 md:grid-cols-3 p-4 bg-surface-nested">
      <div className="md:col-span-3">
        <Section title="Action items">
          {actions.length ? (
            <ol className="flex flex-col gap-3 text-sm">
              {actions.map((action, index) => (
                <li key={action.title} className="flex gap-3">
                  <span className="text-tertiary tabular-nums">{index + 1}.</span>
                  <div>
                    <p className="font-medium text-primary">{action.title}</p>
                    <p className="text-secondary mt-0.5 max-w-4xl">
                      {action.detail}
                      {action.guide && (
                        <>
                          {' '}
                          See <GuideAnchor link={action.guide} />.
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-secondary">
              {row.status === 'ready'
                ? `Nothing to do. It speaks v${REMOVED_VERSION + 1} or later, and every record of it and by it is too.`
                : row.reason}
            </p>
          )}
        </Section>
      </div>

      <Section title="Runtime">
        <Fact label="Status" value={row.reason} />
        <Fact label="Spec" value={snapshot?.specName && `${snapshot.specName} v${snapshot.specVersion}`} />
        <Fact label="XCM pallet" value={snapshot?.palletName} />
        <Fact label="Highest VersionedXcm" value={row.maxInMetadata && `V${row.maxInMetadata}`} />
        <Fact label="Advertised" value={row.advertisedVersion && `v${row.advertisedVersion}`} />
        <Fact
          label="Fallback version (SafeXcmVersion)"
          value={snapshot?.safeVersion && `v${snapshot.safeVersion}`}
        />
        <Fact
          label="Last block"
          value={
            row.chain.paraId === null
              ? 'Relay chain'
              : row.chain.daysSinceLastBlock === 0
                ? 'Today'
                : `${row.chain.daysSinceLastBlock} days ago`
          }
        />
        <Fact label="RPC" value={snapshot?.endpoint ?? snapshot?.error} />
      </Section>

      <Section title="Source">
        {sdk ? (
          <>
            <Fact
              label="Repository"
              value={
                <a className="text-link hover:text-link-hover transition-colors" href={`https://github.com/${sdk.repo}`} target="_blank" rel="noreferrer">
                  {sdk.repo}
                </a>
              }
            />
            <Fact label="SDK release" value={sdk.release ?? sdk.error ?? 'Unknown'} />
            {sdk.oldestRelease && sdk.oldestRelease !== sdk.release && (
              <Fact label="Oldest release in lockfile" value={sdk.oldestRelease} />
            )}
            <Fact label="staging-xcm" value={sdk.crateVersions?.join(', ')} />
            <Fact
              label="Commit"
              value={
                sdk.commit && (
                  <a
                    className="text-link hover:text-link-hover transition-colors font-mono"
                    href={`https://github.com/${sdk.repo}/tree/${sdk.commit}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {sdk.commit.slice(0, 10)}
                  </a>
                )
              }
            />
            <Fact label="Runtime crate found" value={sdk.runtimeVerified ? 'Yes' : 'No: repository match unconfirmed'} />
            <p className="text-sm text-tertiary mt-2">
              {sdk.note ? `${sdk.note}. ` : ''}Read from the default branch, which can be ahead of or behind the deployed
              runtime.
            </p>
          </>
        ) : (
          <p className="text-sm text-secondary">No public repository found. Add one in src/data/repos.json.</p>
        )}
      </Section>

      <Section title={`Peers recording it at v${REMOVED_VERSION} or lower`}>
        {lowRecords.length ? (
          <ul className="text-sm">
            {lowRecords.map((record) => (
              <li key={record.holderKey} className="flex justify-between py-1">
                <span className="text-primary">{nameOf(record.holderKey)}</span>
                <span className={versionClass(record.version)}>v{record.version}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">None.</p>
        )}
      </Section>

      <div className="md:col-span-3">
        <Section title={`What ${row.chain.name} records for its peers (SupportedVersion)`}>
          {supported.length ? (
            <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              {supported.map((record) => (
                <div key={record.peerLabel} className="flex justify-between gap-4 py-1 border-b border-divider">
                  <span className="text-primary truncate" title={record.peerLabel}>
                    {record.peerKey ? nameOf(record.peerKey) : record.peerLabel}
                    {record.peerKey && row.staleRecords.includes(record) && (
                      <span className="text-warning"> · peer has upgraded</span>
                    )}
                  </span>
                  <span className={versionClass(record.version)}>v{record.version}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-secondary">No records.</p>
          )}
        </Section>
      </div>
    </div>
  );
};
