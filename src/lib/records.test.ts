import { describe, expect, it } from 'vitest';
import { latestPerLocation } from './records';

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
