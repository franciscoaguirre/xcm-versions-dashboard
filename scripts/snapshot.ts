/** Runs the same collection as the dashboard from Node and prints a summary. */
import { writeFileSync } from 'node:fs';
import { aggregate } from '../src/lib/aggregate';
import { collectAll, resolveLiveChains } from '../src/lib/run';

const chains = await resolveLiveChains();
console.log(`Checking ${chains.length} live chains`);
let done = 0;
const snapshots = await collectAll(chains, (snapshot, chain) => {
  done++;
  console.log(`[${done}/${chains.length}] ${chain.name}: ${snapshot.state}${snapshot.error ? ` (${snapshot.error})` : ''}`);
});
const reports = aggregate(chains, snapshots);
const output = process.argv[2];
if (output) {
  writeFileSync(output, JSON.stringify(reports, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}
const counts = reports.reduce<Record<string, number>>((tally, report) => {
  tally[report.status] = (tally[report.status] ?? 0) + 1;
  return tally;
}, {});
console.log(counts);
for (const report of reports.filter((item) => item.status === 'blocker')) {
  console.log(`BLOCKER ${report.chain.key} ${report.chain.name}: ${report.reason}`);
}
process.exit(0);
