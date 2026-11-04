import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Governance, PlanState } from '../components/GovernanceCall';
import { aggregate } from './aggregate';
import { recordsLeftAsIs, recordsToFix } from './fixes';
import { planProposals, prepareProposal, type ProposalPlan } from './governance';
import { toRows } from './rows';
import { collectAll, resolveLiveChains } from './run';
import type { ChainInfo, ChainSnapshot } from './types';

export type Phase = 'resolving' | 'collecting' | 'done' | 'failed';

/**
 * Reads every live chain and derives the rows, fixes and referenda from them.
 * Shared by the dashboard and the single-chain page: a chain's status and the
 * records peers hold for it depend on every other chain's storage.
 */
export const useChainData = () => {
  const [phase, setPhase] = useState<Phase>('resolving');
  const [error, setError] = useState<string>();
  const [chains, setChains] = useState<ChainInfo[]>([]);
  const [snapshots, setSnapshots] = useState<ChainSnapshot[]>([]);
  const [checkedAt, setCheckedAt] = useState<Date>();
  const [proposalStates, setProposalStates] = useState<Record<string, PlanState>>({});
  const runId = useRef(0);

  const run = useCallback(async () => {
    const id = ++runId.current;
    // Call data prepared from the previous results would be stale.
    setProposalStates({});
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
  const kept = useMemo(() => recordsLeftAsIs(rows), [rows]);
  // All fixes, not the filtered ones: a filter must not produce a partial system-chain proposal.
  const plans = useMemo(() => planProposals(fixes, rows), [fixes, rows]);
  const prepare = useCallback(
    async (plan: ProposalPlan) => {
      const id = runId.current;
      const setState = (state: PlanState) => {
        if (id === runId.current) setProposalStates((current) => ({ ...current, [plan.id]: state }));
      };
      setState({ phase: 'preparing' });
      try {
        setState({ phase: 'ready', prepared: await prepareProposal(plan, rows) });
      } catch (error) {
        setState({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    },
    [rows],
  );
  // Plans are only complete once every chain has been read.
  const governance: Governance = { plans: phase === 'done' ? plans : [], states: proposalStates, prepare };
  const nameOf = useCallback(
    (key: string | null) => {
      const chain = chains.find((item) => item.key === key);
      if (!chain) return key ?? 'Unknown';
      const relay = chain.relay[0].toUpperCase() + chain.relay.slice(1);
      return chain.paraId === null ? chain.name : `${chain.name} (${relay} ${chain.paraId})`;
    },
    [chains],
  );
  const isBusy = phase === 'resolving' || phase === 'collecting';

  return { phase, error, chains, snapshots, checkedAt, rows, fixes, kept, governance, nameOf, run, isBusy };
};
