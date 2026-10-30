import { describe, expect, it } from 'vitest';
import { resolveLocation } from './location';

const onParachain = { relay: 'polkadot' as const, paraId: 2034 };
const onRelay = { relay: 'kusama' as const, paraId: null };

describe('resolveLocation', () => {
  it('resolves the parent of a parachain to its relay', () => {
    const location = { type: 'V4', value: { parents: 1, interior: { type: 'Here' } } };
    expect(resolveLocation(location, onParachain)).toEqual({ peerKey: 'polkadot:relay', peerLabel: '..' });
  });

  it('resolves a sibling parachain with a single-junction X1 (as PAPI decodes it)', () => {
    const location = {
      type: 'V5',
      value: { parents: 1, interior: { type: 'X1', value: { type: 'Parachain', value: 1000 } } },
    };
    expect(resolveLocation(location, onParachain)).toEqual({
      peerKey: 'polkadot:1000',
      peerLabel: '../Parachain(1000)',
    });
  });

  it('resolves a sibling parachain with an array X1', () => {
    const location = {
      type: 'V4',
      value: { parents: 1, interior: { type: 'X1', value: [{ type: 'Parachain', value: 2000 }] } },
    };
    expect(resolveLocation(location, onParachain).peerKey).toBe('polkadot:2000');
  });

  it('resolves a child parachain when read from the relay', () => {
    const location = {
      type: 'V3',
      value: { parents: 0, interior: { type: 'X1', value: { type: 'Parachain', value: 2023 } } },
    };
    expect(resolveLocation(location, onRelay)).toEqual({ peerKey: 'kusama:2023', peerLabel: 'Parachain(2023)' });
  });

  it('resolves bridged chains through GlobalConsensus', () => {
    const relay = {
      type: 'V5',
      value: { parents: 2, interior: { type: 'X1', value: { type: 'GlobalConsensus', value: { type: 'Kusama' } } } },
    };
    const assetHub = {
      type: 'V5',
      value: {
        parents: 2,
        interior: {
          type: 'X2',
          value: [
            { type: 'GlobalConsensus', value: { type: 'Kusama' } },
            { type: 'Parachain', value: 1000 },
          ],
        },
      },
    };
    expect(resolveLocation(relay, onParachain)).toEqual({
      peerKey: 'kusama:relay',
      peerLabel: '../../GlobalConsensus(Kusama)',
    });
    expect(resolveLocation(assetHub, onParachain).peerKey).toBe('kusama:1000');
  });

  it('returns no chain for non-chain locations', () => {
    const ethereum = {
      type: 'V5',
      value: {
        parents: 2,
        interior: {
          type: 'X1',
          value: { type: 'GlobalConsensus', value: { type: 'Ethereum', value: { chain_id: 1n } } },
        },
      },
    };
    expect(resolveLocation(ethereum, onParachain)).toEqual({
      peerKey: null,
      peerLabel: '../../GlobalConsensus(Ethereum)',
    });
  });
});
