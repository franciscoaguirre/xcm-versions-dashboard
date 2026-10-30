import { describe, expect, it } from 'vitest';
import { parseLockPackages, releasesBehind, resolveRelease } from './sdk';

const lock = `
[[package]]
name = "staging-xcm"
version = "16.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"

[[package]]
name = "my-runtime"
version = "1.0.0"
dependencies = [
 "staging-xcm",
]

[[package]]
name = "staging-xcm"
version = "7.0.0"
source = "git+https://github.com/paritytech/polkadot-sdk?branch=release-polkadot-v1.7.0#deadbeef"
`;

const table = { '16.1.0': 'stable2503', '16.0.0': 'stable2503-rc', '7.0.0': 'v1.7.0', '19.0.0': 'stable2509' };

describe('parseLockPackages', () => {
  it('reads name, version and source of each package', () => {
    const packages = parseLockPackages(lock);
    expect(packages).toHaveLength(3);
    expect(packages[1]).toEqual({ name: 'my-runtime', version: '1.0.0', source: undefined });
  });
});

describe('resolveRelease', () => {
  it('reports the newest release when several crate versions are locked, and keeps all of them', () => {
    const result = resolveRelease(parseLockPackages(lock), 'staging-xcm', table);
    expect(result.release).toBe('stable2503');
    expect(result.crateVersions).toEqual(['7.0.0', '16.1.0']);
    expect(result.oldestRelease).toBe('v1.7.0');
  });

  it('prefers the branch named in a git source over the version table', () => {
    const gitOnly = `
[[package]]
name = "staging-xcm"
version = "14.2.1"
source = "git+https://github.com/paritytech/polkadot-sdk?branch=stable2409#abc"
`;
    expect(resolveRelease(parseLockPackages(gitOnly), 'staging-xcm', table).release).toBe('stable2409');
  });

  it('falls back to the closest lower release for an unknown patch version', () => {
    const patched = `
[[package]]
name = "staging-xcm"
version = "19.0.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;
    expect(resolveRelease(parseLockPackages(patched), 'staging-xcm', table).release).toBe('stable2509');
  });

  it('falls back to the pre-monorepo xcm crate from paritytech/polkadot release branches', () => {
    const legacy = `
[[package]]
name = "xcm"
version = "0.9.43"
source = "git+https://github.com/paritytech//polkadot?branch=release-v0.9.43#ba42b9c"
`;
    expect(resolveRelease(parseLockPackages(legacy), 'staging-xcm', table).release).toBe('v0.9.43');
  });

  it('returns no release when the crate is absent', () => {
    expect(resolveRelease([], 'staging-xcm', table)).toEqual({ release: null, oldestRelease: null, crateVersions: [] });
  });
});

describe('releasesBehind', () => {
  it('counts stable releases between a release and the target', () => {
    expect(releasesBehind('stable2609', 'stable2612')).toBe(1);
    expect(releasesBehind('stable2503-7', 'stable2612')).toBe(7);
    expect(releasesBehind('stable2612', 'stable2612')).toBe(0);
  });

  it('treats any pre-stable v1.x release as further behind than every stable one', () => {
    expect(releasesBehind('v1.7.0', 'stable2612')).toBeGreaterThan(releasesBehind('stable2407', 'stable2612')!);
  });

  it('treats pre-monorepo v0.9.x as further behind than v1.x', () => {
    expect(releasesBehind('v0.9.43', 'stable2612')).toBeGreaterThan(releasesBehind('v1.7.0', 'stable2612')!);
  });

  it('returns null for unknown releases', () => {
    expect(releasesBehind(null, 'stable2612')).toBeNull();
  });
});
