import { describe, expect, it } from 'vitest';
import { latestPerLocation, legacyKeyedEntries, undecodableLegacyEntry } from './records';

describe('latestPerLocation', () => {
  it('keeps the record stored under the newest storage-key version for each location', () => {
    const records = [
      { peerKey: 'polkadot:relay', peerLabel: '..', version: 4, keyVersion: 4 },
      { peerKey: 'polkadot:relay', peerLabel: '..', version: 5, keyVersion: 5 },
      { peerKey: 'polkadot:1000', peerLabel: '../Parachain(1000)', version: 3, keyVersion: 5 },
      { peerKey: 'polkadot:1000', peerLabel: '../Parachain(1000)', version: 5, keyVersion: 4 },
    ];
    expect(latestPerLocation(records)).toEqual([
      { peerKey: 'polkadot:relay', peerLabel: '..', version: 5, keyVersion: 5 },
      { peerKey: 'polkadot:1000', peerLabel: '../Parachain(1000)', version: 3, keyVersion: 5 },
    ]);
  });

  it('leaves distinct locations alone', () => {
    const records = [
      { peerKey: 'kusama:relay', peerLabel: '..', version: 5, keyVersion: 5 },
      { peerKey: 'kusama:1000', peerLabel: '../Parachain(1000)', version: 3, keyVersion: 5 },
    ];
    expect(latestPerLocation(records)).toEqual(records);
  });
});

const location = (variant: number, paraId?: number) => ({
  type: `V${variant}`,
  value: {
    parents: 1,
    interior: paraId === undefined ? { type: 'Here' } : { type: 'X1', value: { type: 'Parachain', value: paraId } },
  },
});

describe('legacyKeyedEntries', () => {
  const context = { relay: 'polkadot' as const, paraId: 2000 };

  it('keeps entries under a v3 key version or a V3 location, and drops current ones', () => {
    const entries = [
      { keyArgs: [3, location(3, 1000)] },
      { keyArgs: [5, location(3, 2034)] },
      { keyArgs: [4, location(4)] },
      { keyArgs: [5, location(5, 1000)] },
    ];
    expect(legacyKeyedEntries('SupportedVersion', entries, context)).toEqual([
      { map: 'SupportedVersion', peerKey: 'polkadot:1000', peerLabel: '../Parachain(1000)', keyVersion: 3, locationVersion: 3 },
      { map: 'SupportedVersion', peerKey: 'polkadot:2034', peerLabel: '../Parachain(2034)', keyVersion: 5, locationVersion: 3 },
    ]);
  });
});

describe('undecodableLegacyEntry', () => {
  it('reads the key version and location variant from the raw storage key', () => {
    const prefix = 'ab'.repeat(32);
    const twox64 = 'cd'.repeat(8);
    const blake2 = 'ef'.repeat(16);
    // Key version 3 as a little-endian u32, then a `V3` location `{ parents: 1, interior: Here }`.
    const key = `0x${prefix}${twox64}03000000${blake2}030100`;
    expect(undecodableLegacyEntry('VersionNotifyTargets', key)).toEqual({
      map: 'VersionNotifyTargets',
      peerKey: null,
      peerLabel: 'Undecodable location',
      keyVersion: 3,
      locationVersion: 3,
    });
  });
});
