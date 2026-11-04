import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import { locationLiteral, parseLocationLabel, recordsLeftAsIs, recordsToFix } from './fixes';
import type { ChainInfo, ChainSnapshot, VersionRecord } from './types';

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

const chains = ['polkadot:relay', 'polkadot:1000', 'polkadot:2000', 'polkadot:2001'].map(chain);

const fixesFor = (snapshots: ChainSnapshot[]) => recordsToFix(aggregate(chains, snapshots));

describe('locationLiteral', () => {
  it('writes a plain location for the relay, a sibling, a child and a bridged chain', () => {
    expect(locationLiteral('..')).toBe('{ parents: 1, interior: Here }');
    expect(locationLiteral('../Parachain(1000)')).toBe('{ parents: 1, interior: { X1: [{ Parachain: 1000 }] } }');
    expect(locationLiteral('Parachain(2000)')).toBe('{ parents: 0, interior: { X1: [{ Parachain: 2000 }] } }');
    expect(locationLiteral('../../GlobalConsensus(Kusama)/Parachain(1000)')).toBe(
      "{ parents: 2, interior: { X2: [{ GlobalConsensus: 'Kusama' }, { Parachain: 1000 }] } }",
    );
  });
});

describe('recordsToFix', () => {
  it('sets a stale record to the version the peer speaks', () => {
    const fixes = fixesFor([
      snapshot('polkadot:2000', { supported: [record('polkadot:1000', '../Parachain(1000)', 3)] }),
      snapshot('polkadot:1000'),
    ]);
    expect(fixes).toEqual([
      expect.objectContaining({
        holderKey: 'polkadot:2000',
        peerKey: 'polkadot:1000',
        recorded: 3,
        newVersion: 5,
        kind: 'stale-record',
        call: 'polkadotXcm.forceXcmVersion',
        argument: '{ parents: 1, interior: { X1: [{ Parachain: 1000 }] } }, 5',
      }),
    ]);
  });

  it("uses the relay's pallet name and the peer's own version", () => {
    const fixes = fixesFor([
      snapshot('polkadot:relay', { palletName: 'XcmPallet', supported: [record('polkadot:2000', 'Parachain(2000)', 3)] }),
      snapshot('polkadot:2000', { maxInMetadata: 4 }),
    ]);
    expect(fixes[0]).toMatchObject({
      holderKey: 'polkadot:relay',
      newVersion: 4,
      call: 'xcmPallet.forceXcmVersion',
      argument: '{ parents: 0, interior: { X1: [{ Parachain: 2000 }] } }, 4',
    });
  });

  it("takes an unreachable peer's version from what other chains record for it", () => {
    const fixes = fixesFor([
      snapshot('polkadot:relay', { supported: [record('polkadot:2001', 'Parachain(2001)', 3)] }),
      snapshot('polkadot:1000', { supported: [record('polkadot:2001', '../Parachain(2001)', 5)] }),
      { key: 'polkadot:2001', state: 'unreachable', advertised: [], supported: [] },
    ]);
    expect(fixes[0]).toMatchObject({ holderKey: 'polkadot:relay', newVersion: 5 });
  });

  it('ignores records of peers that really are on v3', () => {
    const fixes = fixesFor([
      snapshot('polkadot:2000', { supported: [record('polkadot:2001', '../Parachain(2001)', 3)] }),
      snapshot('polkadot:2001', { maxInMetadata: 3, advertised: [record('polkadot:2000', '../Parachain(2000)', 3)] }),
    ]);
    expect(fixes).toEqual([]);
  });

  it('asks every chain whose fallback version is v3 or lower to raise it', () => {
    const fixes = fixesFor([snapshot('polkadot:1000', { safeVersion: 3 })]);
    expect(fixes).toEqual([
      expect.objectContaining({
        holderKey: 'polkadot:1000',
        peerKey: null,
        recorded: 3,
        newVersion: 4,
        kind: 'fallback-version',
        call: 'polkadotXcm.forceDefaultXcmVersion',
        argument: 'Some(4)',
      }),
    ]);
  });
});

describe('parseLocationLabel', () => {
  it('parses the relay, a sibling and a bridged chain', () => {
    expect(parseLocationLabel('..')).toEqual({ parents: 1, junctions: [] });
    expect(parseLocationLabel('../Parachain(1000)')).toEqual({ parents: 1, junctions: [{ Parachain: 1000 }] });
    expect(parseLocationLabel('../../GlobalConsensus(Kusama)/Parachain(1000)')).toEqual({
      parents: 2,
      junctions: [{ GlobalConsensus: 'Kusama' }, { Parachain: 1000 }],
    });
  });
});

describe('recordsLeftAsIs', () => {
  const keptFor = (snapshots: ChainSnapshot[]) => recordsLeftAsIs(aggregate(chains, snapshots));

  it('keeps records of peers that speak v3, with the reason', () => {
    const kept = keptFor([
      snapshot('polkadot:1000', { supported: [record('polkadot:2001', '../Parachain(2001)', 3)] }),
      snapshot('polkadot:2001', { maxInMetadata: 3 }),
    ]);
    expect(kept).toEqual([expect.objectContaining({ holderKey: 'polkadot:1000', reason: expect.stringMatching(/only speaks up to v3/) })]);
  });

  it('keeps records of chains that are no longer running', () => {
    const kept = keptFor([snapshot('polkadot:1000', { supported: [record('polkadot:2040', '../Parachain(2040)', 3)] })]);
    expect(kept[0].reason).toMatch(/no longer running/);
    expect(kept[0].retiredName).toBe('Polkadex');
  });

  it('leaves out records that a fix covers, and records above v3', () => {
    const kept = keptFor([
      snapshot('polkadot:2000', {
        supported: [record('polkadot:1000', '../Parachain(1000)', 3), record('polkadot:relay', '..', 5)],
      }),
      snapshot('polkadot:1000'),
      snapshot('polkadot:relay'),
    ]);
    expect(kept).toEqual([]);
  });
});
