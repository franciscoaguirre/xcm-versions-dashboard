import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import type { ChainInfo, ChainSnapshot, VersionRecord } from './types';

const chain = (key: string): ChainInfo => {
  const [relay, id] = key.split(':');
  return {
    key,
    relay: relay as ChainInfo['relay'],
    paraId: id === 'relay' ? null : Number(id),
    name: key,
    providers: [],
  };
};

const record = (peerKey: string, version: number): VersionRecord => ({ peerKey, peerLabel: peerKey, version });

const snapshot = (key: string, overrides: Partial<ChainSnapshot> = {}): ChainSnapshot => ({
  key,
  state: 'ok',
  maxInMetadata: 5,
  advertised: [record('polkadot:relay', 5)],
  supported: [],
  ...overrides,
});

const statusOf = (reports: ReturnType<typeof aggregate>, key: string) =>
  reports.find((report) => report.chain.key === key)?.status;

describe('aggregate', () => {
  const chains = ['polkadot:relay', 'polkadot:1000', 'polkadot:2000', 'polkadot:2001'].map(chain);

  it('marks a chain whose metadata tops out at V3 as a blocker', () => {
    const reports = aggregate(chains, [snapshot('polkadot:2000', { maxInMetadata: 3 })]);
    expect(statusOf(reports, 'polkadot:2000')).toBe('blocker');
  });

  it('marks a chain advertising v3 as a blocker even if its metadata knows V5', () => {
    const reports = aggregate(chains, [
      snapshot('polkadot:2000', { advertised: [record('polkadot:relay', 3)] }),
    ]);
    const report = reports.find((item) => item.chain.key === 'polkadot:2000')!;
    expect(report.status).toBe('blocker');
    expect(report.advertisedVersion).toBe(3);
  });

  it('marks an upgraded chain that a peer still records at v3 as stale-peers', () => {
    const reports = aggregate(chains, [
      snapshot('polkadot:relay', { supported: [record('polkadot:2000', 3)] }),
      snapshot('polkadot:2000'),
    ]);
    const report = reports.find((item) => item.chain.key === 'polkadot:2000')!;
    expect(report.status).toBe('stale-peers');
    expect(report.recordedByPeers).toEqual([{ holderKey: 'polkadot:relay', version: 3 }]);
  });

  it('marks a chain holding v3 records for upgraded peers as holds-stale-records', () => {
    const reports = aggregate(chains, [
      snapshot('polkadot:1000', { supported: [record('polkadot:2000', 3), record('polkadot:2001', 3)] }),
      snapshot('polkadot:2000'),
      snapshot('polkadot:2001', { maxInMetadata: 3 }),
    ]);
    const report = reports.find((item) => item.chain.key === 'polkadot:1000')!;
    expect(report.status).toBe('holds-stale-records');
    // 2001 really is on v3, so recording it at v3 is not stale.
    expect(report.staleRecords.map((item) => item.peerKey)).toEqual(['polkadot:2000']);
  });

  it('marks a fully upgraded chain as ready', () => {
    const reports = aggregate(chains, [
      snapshot('polkadot:relay', { supported: [record('polkadot:1000', 5)] }),
      snapshot('polkadot:1000'),
    ]);
    expect(statusOf(reports, 'polkadot:1000')).toBe('ready');
  });

  it('infers a blocker from peer records when an unreachable chain is only ever recorded at v3 or lower', () => {
    const reports = aggregate(chains, [
      snapshot('polkadot:relay', { supported: [record('polkadot:2000', 2)] }),
      snapshot('polkadot:1000', { supported: [record('polkadot:2000', 3)] }),
      { key: 'polkadot:2000', state: 'unreachable', advertised: [], supported: [] },
    ]);
    const report = reports.find((item) => item.chain.key === 'polkadot:2000')!;
    expect(report.status).toBe('blocker');
    expect(report.speakableSource).toBe('peers');
    expect(report.speakableVersion).toBe(3);
  });

  it('marks an unreachable chain with no low records as unreachable, and unqueried chains as pending', () => {
    const reports = aggregate(chains, [
      snapshot('polkadot:relay', { supported: [record('polkadot:2000', 5)] }),
      { key: 'polkadot:2000', state: 'unreachable', advertised: [], supported: [] },
    ]);
    expect(statusOf(reports, 'polkadot:2000')).toBe('unreachable');
    expect(statusOf(reports, 'polkadot:2001')).toBe('pending');
  });

  it('explains a reachable chain without XCM version storage by what its runtime can encode', () => {
    const reports = aggregate(chains, [
      { key: 'polkadot:2000', state: 'no-xcm-pallet', maxInMetadata: 2, advertised: [], supported: [] },
    ]);
    const report = reports.find((item) => item.chain.key === 'polkadot:2000')!;
    expect(report.status).toBe('blocker');
    expect(report.reason).toBe('Runtime can only encode up to XCM v2 and has no XCM version storage');
  });
});
