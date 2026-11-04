/**
 * Runs the same collection as the dashboard, then prepares and dry-runs the governance call that
 * applies every chain's version fixes. Writes one file per referendum to exports/governance/:
 *   <relay>-system.json    on Asset Hub, for the relay and every system chain
 *   <relay>-<para id>.json  for each other chain, submitted through its own governance
 *   index.json              a summary of all of them
 * Exits non-zero if any proposal couldn't be prepared or failed its dry run.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { aggregate } from '../src/lib/aggregate';
import { runPool } from '../src/lib/collect';
import { recordsToFix } from '../src/lib/fixes';
import { describe, planProposals, prepareProposal, type PreparedProposal } from '../src/lib/governance';
import { CONCURRENCY, collectAll, resolveLiveChains } from '../src/lib/run';

const chains = await resolveLiveChains();
console.log(`Checking ${chains.length} live chains`);
const snapshots = await collectAll(chains, (snapshot, chain) => {
  if (snapshot.state !== 'ok') console.log(`${chain.name}: ${snapshot.state}`);
});
const reports = aggregate(chains, snapshots);
const plans = planProposals(recordsToFix(reports), reports);
console.log(`Preparing ${plans.length} proposals`);

type Outcome = { id: string; prepared?: PreparedProposal; error?: string };
const outcomes = await runPool(plans, CONCURRENCY, async (plan): Promise<Outcome> => {
  try {
    return { id: plan.id, prepared: await prepareProposal(plan, reports) };
  } catch (error) {
    return { id: plan.id, error: error instanceof Error ? error.message : String(error) };
  }
});

const directory = new URL('../exports/governance/', import.meta.url);
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const toJson = (value: unknown) => JSON.stringify(JSON.parse(describe(value)), null, 2);
const nameOf = (key: string) => reports.find((report) => report.chain.key === key)?.chain.name ?? key;

for (const { id, prepared, error } of outcomes) {
  writeFileSync(new URL(`${id}.json`, directory), toJson(prepared ?? { id, error }));
  if (!prepared) {
    console.log(`✗ ${id}: ${error}`);
    continue;
  }
  const { plan, dryRun } = prepared;
  const mark = { passed: '✓', unavailable: '?', failed: '✗' }[dryRun.status];
  const covered = [plan.submitOnKey, ...plan.remote.map((part) => part.destinationKey)].map(nameOf).join(', ');
  console.log(`${mark} ${id} on ${nameOf(plan.submitOnKey)} (${prepared.length} bytes), dry run ${dryRun.status}: ${covered}`);
  for (const check of dryRun.checks) console.log(`    ${check.passed ? '✓' : '✗'} ${nameOf(check.chainKey)}: ${check.detail}`);
}

writeFileSync(
  new URL('index.json', directory),
  toJson(
    outcomes.map(({ id, prepared, error }) => ({
      id,
      submitOn: prepared?.submitOn.key,
      fixes: prepared ? prepared.plan.local.length + prepared.plan.remote.reduce((sum, part) => sum + part.fixes.length, 0) : undefined,
      callHash: prepared?.callHash,
      dryRun: prepared?.dryRun.status,
      error,
    })),
  ),
);
console.log(`Wrote ${outcomes.length} proposals to exports/governance/`);
const failed = outcomes.filter((outcome) => !outcome.prepared || outcome.prepared.dryRun.status === 'failed');
process.exit(failed.length ? 1 : 0);
