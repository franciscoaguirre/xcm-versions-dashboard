import { Check, Copy, ExternalLink, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { PreparedProposal, ProposalPlan } from '../lib/governance';
import type { ChainKey } from '../lib/types';

export type PlanState =
  | { phase: 'idle' }
  | { phase: 'preparing' }
  | { phase: 'ready'; prepared: PreparedProposal }
  | { phase: 'failed'; error: string };

/** The referenda for the current results, and the call data prepared so far (kept while rows collapse). */
export interface Governance {
  plans: ProposalPlan[];
  states: Record<string, PlanState>;
  prepare: (plan: ProposalPlan) => void;
}

/** The referendum that applies `chainKey`'s fixes, or that `chainKey` submits (Asset Hub). */
export const planFor = (plans: ProposalPlan[], chainKey: ChainKey) =>
  plans.find(
    (plan) =>
      plan.submitOnKey === chainKey || plan.remote.some((part) => part.destinationKey === chainKey),
  );

type NameOf = (key: string | null) => string;

const DRY_RUN_LABELS = {
  passed: { text: 'Dry run passed', className: 'text-success' },
  failed: { text: 'Dry run failed', className: 'text-error' },
  unavailable: { text: 'Dry run unavailable', className: 'text-warning' },
} as const;

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-secondary hover:text-secondary-hover transition-colors cursor-pointer"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon className="w-4 h-4" aria-hidden />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const HexField = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-secondary">{label}</span>
      <CopyButton text={value} />
    </div>
    <code className="font-mono text-xs text-primary break-all select-all bg-surface-nested rounded-small p-2 max-h-32 overflow-y-auto">
      {value}
    </code>
  </div>
);

const Prepared = ({ prepared, nameOf }: { prepared: PreparedProposal; nameOf: NameOf }) => {
  const label = DRY_RUN_LABELS[prepared.dryRun.status];
  return (
    <div className="flex flex-col gap-3 mt-3">
      <HexField label={`Call data (${prepared.length} bytes)`} value={prepared.callData} />
      <HexField label="Preimage hash" value={prepared.callHash} />
      <p className="text-xs text-secondary">
        Encoded for {prepared.submitOn.specName} v{prepared.submitOn.specVersion}.{' '}
        <a
          className="inline-flex items-center gap-1 text-link hover:text-link-hover transition-colors"
          href={prepared.decodeUrl}
          target="_blank"
          rel="noreferrer"
        >
          Decode in polkadot.js apps
          <ExternalLink className="w-3 h-3" aria-hidden />
        </a>
      </p>
      <div>
        <p className={`text-sm font-medium ${label.className}`}>{label.text}</p>
        <ul className="text-xs text-secondary mt-1 flex flex-col gap-0.5">
          {prepared.dryRun.checks.map((check) => (
            <li key={check.chainKey}>
              <span className={check.passed ? 'text-success' : 'text-error'}>{check.passed ? '✓' : '✗'}</span>{' '}
              {nameOf(check.chainKey)}: {check.detail}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const describePlan = (plan: ProposalPlan, chainKey: ChainKey, nameOf: NameOf) => {
  if (plan.kind === 'chain') return 'One call for its own governance, applying every fix above.';
  const covered = [...(plan.local.length ? [plan.submitOnKey] : []), ...plan.remote.map((part) => part.destinationKey)];
  const where = chainKey === plan.submitOnKey ? 'Submitted here' : `Submitted on ${nameOf(plan.submitOnKey)}`;
  return (
    `${where}, as one referendum for every system chain on this relay: it applies Asset Hub's own fixes and sends ` +
    `each other chain its fixes as a Superuser Transact. Covers ${covered.map(nameOf).join(', ')}.`
  );
};

interface GovernanceCallProps {
  plan: ProposalPlan;
  /** The chain whose row this is shown in. */
  chainKey: ChainKey;
  state: PlanState;
  onPrepare: () => void;
  nameOf: NameOf;
}

export const GovernanceCall = ({ plan, chainKey, state, onPrepare, nameOf }: GovernanceCallProps) => (
  <div className="border-t border-divider pt-3 mt-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-primary">Governance call</p>
        <p className="text-sm text-secondary mt-0.5 max-w-3xl">{describePlan(plan, chainKey, nameOf)}</p>
      </div>
      {state.phase !== 'ready' && (
        <button
          type="button"
          className="inline-flex items-center gap-2 bg-action-secondary text-primary font-medium text-sm px-3 py-1.5 rounded-small hover:bg-action-secondary-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={state.phase === 'preparing' || !!plan.problem}
          onClick={onPrepare}
        >
          {state.phase === 'preparing' && <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden />}
          {state.phase === 'preparing' ? 'Encoding and dry-running…' : 'Prepare call data'}
        </button>
      )}
    </div>
    {plan.problem && <p className="text-sm text-error mt-2">{plan.problem}</p>}
    {state.phase === 'failed' && <p className="text-sm text-error mt-2 break-words">{state.error}</p>}
    {state.phase === 'ready' && <Prepared prepared={state.prepared} nameOf={nameOf} />}
  </div>
);
