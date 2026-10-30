/** Crate version -> polkadot-sdk release name (`stable2503`, `stable2412-3`, `v1.7.0`). */
export type ReleaseTable = Record<string, string>;

export interface LockPackage {
  name: string;
  version: string;
  source?: string;
}

/** The first stable release without XCMv3. */
export const TARGET_RELEASE = 'stable2612';

/** polkadot-sdk stable releases in order; anything older is a pre-stable `v1.x` release. */
export const STABLE_RELEASES = [
  'stable2407',
  'stable2409',
  'stable2412',
  'stable2503',
  'stable2506',
  'stable2509',
  'stable2512',
  'stable2603',
  'stable2606',
  'stable2609',
  'stable2612',
];

export const parseLockPackages = (lock: string): LockPackage[] =>
  lock
    .split('[[package]]')
    .slice(1)
    .map((block) => ({
      name: /^name = "([^"]+)"/m.exec(block)?.[1] ?? '',
      version: /^version = "([^"]+)"/m.exec(block)?.[1] ?? '',
      source: /^source = "([^"]+)"/m.exec(block)?.[1],
    }));

const compareVersions = (a: string, b: string) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

/** `?branch=stable2409` / `?tag=polkadot-stable2412-1` / `?branch=release-polkadot-v1.7.0` -> release name. */
const releaseFromGitSource = (source?: string) => {
  const reference = source && /[?&](?:branch|tag)=([^#&]+)/.exec(source)?.[1];
  if (!reference) return undefined;
  const name = reference.replace(/^release-/, '').replace(/^polkadot-/, '');
  return /^(stable\d{4}(-\d+)?|v[01]\.\d+\.\d+)$/.test(name) ? name : undefined;
};

const releaseFor = (lockPackage: LockPackage, table: ReleaseTable) => {
  const fromSource = releaseFromGitSource(lockPackage.source);
  if (fromSource) return fromSource;
  if (table[lockPackage.version]) return table[lockPackage.version];
  // An unlisted patch version belongs to the closest lower release with the same major version.
  const major = lockPackage.version.split('.')[0];
  const lower = Object.keys(table)
    .filter((version) => version.split('.')[0] === major && compareVersions(version, lockPackage.version) <= 0)
    .sort(compareVersions)
    .at(-1);
  return lower ? table[lower] : null;
};

/** Before the polkadot-sdk monorepo, XCM shipped as the `xcm` crate on paritytech/polkadot release branches. */
const LEGACY_CRATE = 'xcm';

export const resolveRelease = (packages: LockPackage[], crate: string, table: ReleaseTable) => {
  const byVersion = (a: LockPackage, b: LockPackage) => compareVersions(a.version, b.version);
  let matches = packages.filter((item) => item.name === crate).sort(byVersion);
  if (!matches.length) {
    matches = packages
      .filter((item) => item.name === LEGACY_CRATE && /paritytech\/+polkadot\b/.test(item.source ?? ''))
      .sort(byVersion);
  }
  if (!matches.length) return { release: null, oldestRelease: null, crateVersions: [] as string[] };
  return {
    release: releaseFor(matches.at(-1)!, table),
    oldestRelease: releaseFor(matches[0], table),
    crateVersions: matches.map((item) => item.version),
  };
};

/** Number of stable releases between `release` and `target`; pre-stable `v1.x` and pre-monorepo `v0.9.x` rank past the oldest. */
export const releasesBehind = (release: string | null | undefined, target = TARGET_RELEASE): number | null => {
  if (!release) return null;
  const targetIndex = STABLE_RELEASES.indexOf(target);
  if (release.startsWith('v1.')) return targetIndex + 1;
  if (release.startsWith('v0.')) return targetIndex + 2;
  const base = /^stable\d{4}/.exec(release)?.[0];
  const index = base ? STABLE_RELEASES.indexOf(base) : -1;
  return index === -1 ? null : Math.max(0, targetIndex - index);
};
