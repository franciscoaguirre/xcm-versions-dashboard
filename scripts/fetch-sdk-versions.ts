/**
 * Resolves which polkadot-sdk release each chain's source repository builds against.
 *
 * 1. Builds a table of `staging-xcm` crate version -> polkadot-sdk release from the
 *    tags of paritytech/polkadot-sdk.
 * 2. For each repo in src/data/repos.json, reads Cargo.lock from the default branch and
 *    looks up its `staging-xcm` version(s).
 *
 * Uses raw.githubusercontent.com and `git ls-remote`, neither of which spends GitHub API
 * quota. Set GITHUB_TOKEN to also record each commit's date.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import repos from '../src/data/repos.json';
import { runPool } from '../src/lib/collect';
import { parseLockPackages, resolveRelease, type ReleaseTable } from '../src/lib/sdk';

const SDK_REPO = 'paritytech/polkadot-sdk';
const XCM_CRATE = 'staging-xcm';

const raw = async (repo: string, ref: string, path: string) => {
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`);
  return response.ok ? response.text() : null;
};

const listTags = (repo: string, pattern: string) =>
  execFileSync('git', ['ls-remote', '--tags', `https://github.com/${repo}`, pattern], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.split('\t')[1]?.replace('refs/tags/', ''))
    .filter((tag): tag is string => !!tag && !tag.endsWith('^{}'));

const headCommit = (repo: string) =>
  execFileSync('git', ['ls-remote', `https://github.com/${repo}`, 'HEAD'], { encoding: 'utf8' }).split('\t')[0] || null;

const commitDate = async (repo: string, sha: string) => {
  if (!process.env.GITHUB_TOKEN) return null;
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  });
  return response.ok ? ((await response.json()).commit.committer.date as string) : null;
};

const buildReleaseTable = async (): Promise<ReleaseTable> => {
  // Final releases only. Stable names come first so they win over their polkadot-v1.x twins.
  const isFinal = (tag: string) => !/rc|nix|backport|6210/.test(tag);
  const stable = listTags(SDK_REPO, 'polkadot-stable*').filter(isFinal);
  const legacy = listTags(SDK_REPO, 'polkadot-v1.*').filter(isFinal);
  const table: ReleaseTable = {};
  const versions = await runPool([...stable, ...legacy], 16, async (tag) => {
    const manifest = await raw(SDK_REPO, tag, 'polkadot/xcm/Cargo.toml');
    return { tag, version: manifest?.match(/^version\s*=\s*"([^"]+)"/m)?.[1] };
  });
  for (const { tag, version } of versions) {
    if (version && !table[version]) table[version] = tag.replace(/^polkadot-/, '');
  }
  return table;
};

const table = await buildReleaseTable();
console.log(`Release table: ${Object.keys(table).length} ${XCM_CRATE} versions`);
writeFileSync(new URL('../src/data/sdk-releases.json', import.meta.url), `${JSON.stringify(table, null, 2)}\n`);

type RepoEntry = { repo: string; lockPath: string; runtimeHint: string; source: string; note?: string };
const entries = Object.entries(repos as Record<string, RepoEntry>);
const lockCache = new Map<string, Promise<string | null>>();

const results = await runPool(entries, 8, async ([key, entry]) => {
  const cacheKey = `${entry.repo}/${entry.lockPath}`;
  if (!lockCache.has(cacheKey)) lockCache.set(cacheKey, raw(entry.repo, 'HEAD', entry.lockPath));
  const lock = await lockCache.get(cacheKey)!;
  const commit = headCommit(entry.repo);
  if (!lock) return [key, { repo: entry.repo, commit, error: `No ${entry.lockPath} on default branch` }] as const;

  const packages = parseLockPackages(lock);
  const hint = entry.runtimeHint.replace(/[-_]/g, '');
  const runtimeCrates = packages
    .filter((item) => !item.source && /runtime/.test(item.name))
    .map((item) => item.name);
  const matched = runtimeCrates.some((name) => name.replace(/[-_]/g, '').includes(hint));

  return [
    key,
    {
      repo: entry.repo,
      lockPath: entry.lockPath,
      commit,
      commitDate: commit ? await commitDate(entry.repo, commit) : null,
      runtimeVerified: matched,
      ...resolveRelease(packages, XCM_CRATE, table),
      note: entry.note,
      fetchedAt: new Date().toISOString(),
    },
  ] as const;
});

const output = Object.fromEntries(results);
writeFileSync(new URL('../src/data/sdk-versions.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
for (const [key, value] of results) {
  const summary = 'error' in value ? value.error : `${value.release ?? '?'} (xcm ${value.crateVersions.join(', ')})${value.runtimeVerified ? '' : ' [runtime not matched]'}`;
  console.log(key.padEnd(16), value.repo.padEnd(40), summary);
}
