import { describe, expect, it } from 'vitest';
import { actionItems } from './actions';
import { aggregate } from './aggregate';
import { recordsToFix } from './fixes';
import type { ChainInfo, ChainReport, ChainSnapshot, VersionRecord } from './types';

const chain = (key: string): ChainInfo => {
  const [relay, id] = key.split(':');
  return { key, relay: relay as ChainInfo['relay'], paraId: id === 'relay' ? null : Number(id), name: key, providers: [], activity: 'active' };
};

const record = (peerKey: string, peerLabel: string, version: number): VersionRecord => ({ peerKey, peerLabel, version });

const snapshot = (key: string, overrides: Partial<ChainSnapshot> = {}): ChainSnapshot => ({
  key,
  state: 'ok',
  palletName: 'PolkadotXcm',
  maxInMetadata: 5,
  safeVersion: 5,
  advertised: [],
  supported: [],
  ...overrides,
});

const chains = ['polkadot:relay', 'polkadot:1000', 'polkadot:2000'].map(chain);
const nameOf = (key: string | null) => `name of ${key}`;

const actionsOf = (key: string, snapshots: ChainSnapshot[]) => {
  const reports = aggregate(chains, snapshots);
  const fixes = recordsToFix(reports);
  return actionItems(reports.find((report: ChainReport) => report.chain.key === key)!, fixes, nameOf);
};

describe('actionItems', () => {
  it('tells a chain that speaks only v3 to upgrade, pointing at the v3 to v4 guide', () => {
    const items = actionsOf('polkadot:2000', [
      snapshot('polkadot:relay'),
      snapshot('polkadot:1000'),
      snapshot('polkadot:2000', { maxInMetadata: 3 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toMatch(/upgrade/i);
    expect(items[0].guide?.slug).toBe('migrating-xcm-v3-to-v4');
  });

  it('asks an unreachable blocker for a public RPC as well', () => {
    const items = actionsOf('polkadot:2000', [
      snapshot('polkadot:relay', { supported: [record('polkadot:2000', 'Parachain(2000)', 3)] }),
      snapshot('polkadot:1000'),
      snapshot('polkadot:2000', { state: 'unreachable', error: 'RPC did not respond', maxInMetadata: undefined, safeVersion: undefined }),
    ]);
    expect(items.map((item) => item.title)).toEqual([expect.stringMatching(/upgrade/i), expect.stringMatching(/RPC/)]);
  });

  it("lists the records a chain must fix and its fallback version, linking the records guide", () => {
    const items = actionsOf('polkadot:2000', [
      snapshot('polkadot:relay'),
      snapshot('polkadot:1000'),
      snapshot('polkadot:2000', { safeVersion: 3, supported: [record('polkadot:1000', '../Parachain(1000)', 3)] }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Fix 1 version record');
    expect(items[0].detail).toContain('name of polkadot:1000');
    expect(items[1].title).toMatch(/fallback/i);
    expect(items[1].detail).toContain('polkadotXcm.forceDefaultXcmVersion(Some(4))');
    expect(items.every((item) => item.guide?.slug === 'fixing-xcm-version-records')).toBe(true);
  });

  it('names the peers that still record an upgraded chain at v3', () => {
    const items = actionsOf('polkadot:1000', [
      snapshot('polkadot:relay', { supported: [record('polkadot:1000', 'Parachain(1000)', 3)] }),
      snapshot('polkadot:1000'),
      snapshot('polkadot:2000'),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].detail).toContain('name of polkadot:relay');
  });

  it('has nothing to do for a ready chain', () => {
    expect(actionsOf('polkadot:1000', chains.map((item) => snapshot(item.key)))).toEqual([]);
  });

  it('asks an unreachable chain with no known version for a public RPC', () => {
    const items = actionsOf('polkadot:2000', [
      snapshot('polkadot:relay'),
      snapshot('polkadot:1000'),
      snapshot('polkadot:2000', { state: 'unreachable', error: 'RPC did not respond', maxInMetadata: undefined, safeVersion: undefined }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toMatch(/RPC/);
  });
});
