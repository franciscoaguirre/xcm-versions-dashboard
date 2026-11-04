import type { ReactNode } from 'react';
import { actionItems } from '../lib/actions';
import { REMOVED_VERSION } from '../lib/aggregate';
import type { Fix, KeptRecord } from '../lib/fixes';
import type { Row } from '../lib/rows';
import { GovernanceCall, planFor, type Governance } from './GovernanceCall';
import { GuideAnchor } from './GuideAnchor';

interface ChainDetailProps {
  row: Row;
  fixes: Fix[];
  /** Records at v3 or lower that no call changes, across all chains. */
  kept: KeptRecord[];
  governance: Governance;
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

/** This chain's own version settings that still point at v3 or lower, with the call that fixes each. */
const FixesTable = ({ fixes, nameOf }: { fixes: Fix[]; nameOf: ChainDetailProps['nameOf'] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-divider text-left text-secondary">
          {['Peer', 'Recorded as', 'Set to', 'Call', 'Arguments'].map((label) => (
            <th key={label} className="pr-4 py-2 font-medium whitespace-nowrap">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {fixes.map((fix) => (
          <tr key={fix.peerKey ?? 'fallback'} className="border-b border-divider align-top">
            <td className="pr-4 py-2 text-primary">{fix.peerKey ? nameOf(fix.peerKey) : 'Any destination without a record'}</td>
            <td className="pr-4 py-2 text-error font-semibold">v{fix.recorded}</td>
            <td className="pr-4 py-2 text-primary">v{fix.newVersion}</td>
            <td className="pr-4 py-2 font-mono text-xs text-primary whitespace-nowrap">{fix.call}</td>
            <td className="py-2 font-mono text-xs text-primary break-words select-all">{fix.argument}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Records at v3 or lower that the governance call deliberately leaves alone. */
const KeptTable = ({ kept, nameOf }: { kept: KeptRecord[]; nameOf: ChainDetailProps['nameOf'] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-divider text-left text-secondary">
          {['Peer', 'Recorded as', 'Why it stays'].map((label) => (
            <th key={label} className="pr-4 py-2 font-medium whitespace-nowrap">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {kept.map(({ record, retiredName, reason }) => (
          <tr key={record.peerLabel} className="border-b border-divider align-top">
            <td className="pr-4 py-2 text-primary whitespace-nowrap" title={record.peerLabel}>
              {retiredName ?? (record.peerKey ? nameOf(record.peerKey) : record.peerLabel)}
            </td>
            <td className="pr-4 py-2 text-primary">v{record.version}</td>
            <td className="py-2 text-secondary">{reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const ChainDetail = ({ row, fixes, kept, governance, nameOf }: ChainDetailProps) => {
  const { snapshot, sdk } = row;
  const actions = actionItems(row, fixes, nameOf);
  const own = fixes
    .filter((fix) => fix.holderKey === row.chain.key)
    .sort((a, b) => Number(a.kind === 'fallback-version') - Number(b.kind === 'fallback-version') || nameOf(a.peerKey).localeCompare(nameOf(b.peerKey)));
  const ownKept = kept
    .filter((item) => item.holderKey === row.chain.key)
    .sort((a, b) => nameOf(a.record.peerKey ?? a.record.peerLabel).localeCompare(nameOf(b.record.peerKey ?? b.record.peerLabel), undefined, { numeric: true }));
  // Asset Hub shows its relay's system proposal even with no fixes of its own, since it submits it.
  const plan = planFor(governance.plans, row.chain.key);
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

      {(own.length > 0 || ownKept.length > 0 || plan) && (
        <div className="md:col-span-3">
          <Section title="Records to fix">
            {own.length ? (
              <>
                <p className="text-sm text-secondary mb-2 max-w-4xl">
                  Settings that still point at XCM v{REMOVED_VERSION} or lower. Once this chain runs stable2612 it can
                  no longer encode v{REMOVED_VERSION}, so messages relying on them fail.{' '}
                  <GuideAnchor link={{ slug: 'fixing-xcm-version-records' }}>Why, and how to fix them</GuideAnchor>.
                </p>
                <FixesTable fixes={own} nameOf={nameOf} />
              </>
            ) : (
              <p className="text-sm text-secondary">None of its own.</p>
            )}
            {ownKept.length > 0 && (
              <div className="border-t border-divider pt-3 mt-3">
                <p className="text-sm font-medium text-primary">Left as is</p>
                <p className="text-sm text-secondary mt-0.5 mb-2 max-w-4xl">
                  Also at v{REMOVED_VERSION} or lower, but no call should change these: the peer can't receive anything
                  newer, or no longer runs. If a peer upgrades, its record moves to the fixes above.
                </p>
                <KeptTable kept={ownKept} nameOf={nameOf} />
              </div>
            )}
            {plan && (
              <GovernanceCall
                plan={plan}
                chainKey={row.chain.key}
                state={governance.states[plan.id] ?? { phase: 'idle' }}
                onPrepare={() => governance.prepare(plan)}
                nameOf={nameOf}
              />
            )}
          </Section>
        </div>
      )}

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
