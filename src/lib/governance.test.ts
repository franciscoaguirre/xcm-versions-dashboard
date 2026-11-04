import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import { recordsToFix } from './fixes';
import {
  assetHubSeenFrom,
  batchValue,
  destinationFromAssetHub,
  forceCallValue,
  isSystemChain,
  locationValue,
  planProposals,
  remoteMessage,
} from './governance';
import type { ChainInfo, ChainSnapshot, VersionRecord } from './types';

const chain = (key: string): ChainInfo => {
  const [relay, id] = key.split(':');
  return { key, relay: relay as ChainInfo['relay'], paraId: id === 'relay' ? null : Number(id), name: key, providers: [], activity: 'active' };
};

const record = (peerKey: string, peerLabel: string, version: number): VersionRecord => ({ peerKey, peerLabel, version });

const snapshot = (key: string, overrides: Partial<ChainSnapshot> = {}): ChainSnapshot => ({
  key,
  state: 'ok',
  palletName: key.endsWith(':relay') ? 'XcmPallet' : 'PolkadotXcm',
  maxInMetadata: 5,
  safeVersion: 5,
  advertised: [],
  supported: [],
  ...overrides,
});

const keys = ['polkadot:relay', 'polkadot:1000', 'polkadot:1001', 'polkadot:1999', 'polkadot:2000', 'polkadot:2034', 'kusama:relay', 'kusama:1000'];

const plansFor = (snapshots: ChainSnapshot[]) => {
  const reports = aggregate(keys.map(chain), snapshots);
  return planProposals(recordsToFix(reports), reports);
};

/** Every chain readable, so peers' versions are known; overrides replace the default snapshot. */
const everyChain = (...overrides: ChainSnapshot[]) =>
  keys.map((key) => overrides.find((item) => item.key === key) ?? snapshot(key));

describe('isSystemChain', () => {
  it('counts the relay and para IDs below 2000', () => {
    expect(isSystemChain(chain('polkadot:relay'))).toBe(true);
    expect(isSystemChain(chain('polkadot:1999'))).toBe(true);
    expect(isSystemChain(chain('polkadot:2000'))).toBe(false);
  });
});

describe('planProposals', () => {
  it('puts the relay and every system chain into one Asset Hub proposal per relay', () => {
    const plans = plansFor(
      everyChain(
        snapshot('polkadot:relay', { supported: [record('polkadot:2034', 'Parachain(2034)', 3)] }),
        snapshot('polkadot:1000', { safeVersion: 3 }),
        snapshot('polkadot:1999', { supported: [record('polkadot:2034', '../Parachain(2034)', 3)] }),
        snapshot('kusama:relay', { safeVersion: 3 }),
      ),
    );
    expect(plans.map((plan) => plan.id)).toEqual(['kusama-system', 'polkadot-system']);

    const polkadot = plans[1];
    expect(polkadot).toMatchObject({ kind: 'system', submitOnKey: 'polkadot:1000', problem: undefined });
    expect(polkadot.local.map((fix) => fix.kind)).toEqual(['fallback-version']);
    expect(polkadot.remote.map((part) => part.destinationKey)).toEqual(['polkadot:relay', 'polkadot:1999']);

    const kusama = plans[0];
    expect(kusama).toMatchObject({ submitOnKey: 'kusama:1000', local: [] });
    expect(kusama.remote.map((part) => part.destinationKey)).toEqual(['kusama:relay']);
  });

  it('gives every other chain its own proposal, and none to chains with nothing to fix', () => {
    const plans = plansFor(
      everyChain(
        snapshot('polkadot:2000', {
          safeVersion: 3,
          supported: [record('polkadot:2034', '../Parachain(2034)', 3), record('polkadot:1000', '../Parachain(1000)', 3)],
        }),
      ),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: 'polkadot-2000', kind: 'chain', submitOnKey: 'polkadot:2000', remote: [] });
    expect(plans[0].local).toHaveLength(3);
  });

  it("flags a system proposal whose Asset Hub couldn't be read", () => {
    const plans = plansFor(
      everyChain(snapshot('polkadot:relay', { safeVersion: 3 }), {
        key: 'polkadot:1000',
        state: 'unreachable',
        advertised: [],
        supported: [],
      }),
    );
    expect(plans[0].problem).toMatch(/Asset Hub/);
  });
});

describe('call values', () => {
  it('writes locations the way PAPI encodes them', () => {
    expect(locationValue({ parents: 1, junctions: [] })).toEqual({ parents: 1, interior: { type: 'Here', value: undefined } });
    expect(locationValue({ parents: 0, junctions: [{ Parachain: 2034 }] })).toEqual({
      parents: 0,
      interior: { type: 'X1', value: { type: 'Parachain', value: 2034 } },
    });
    expect(locationValue({ parents: 2, junctions: [{ GlobalConsensus: 'Kusama' }, { Parachain: 1000 }] })).toEqual({
      parents: 2,
      interior: {
        type: 'X2',
        value: [
          { type: 'GlobalConsensus', value: { type: 'Kusama', value: undefined } },
          { type: 'Parachain', value: 1000 },
        ],
      },
    });
  });

  it('builds force calls and batches only when there is more than one', () => {
    const [stale, fallback] = recordsToFix(
      aggregate(keys.map(chain), everyChain(snapshot('polkadot:relay', { safeVersion: 3, supported: [record('polkadot:2034', 'Parachain(2034)', 3)] }))),
    );
    const staleCall = forceCallValue('XcmPallet', stale);
    expect(staleCall).toEqual({
      type: 'XcmPallet',
      value: { type: 'force_xcm_version', value: { location: locationValue({ parents: 0, junctions: [{ Parachain: 2034 }] }), version: 5 } },
    });
    expect(forceCallValue('XcmPallet', fallback)).toEqual({
      type: 'XcmPallet',
      value: { type: 'force_default_xcm_version', value: { maybe_xcm_version: 4 } },
    });
    expect(batchValue([staleCall])).toBe(staleCall);
    expect(batchValue([staleCall, staleCall])).toMatchObject({ type: 'Utility', value: { type: 'batch_all' } });
  });

  it('addresses system chains from Asset Hub and back', () => {
    expect(destinationFromAssetHub('polkadot:relay')).toEqual({ parents: 1, junctions: [] });
    expect(destinationFromAssetHub('polkadot:1001')).toEqual({ parents: 1, junctions: [{ Parachain: 1001 }] });
    expect(assetHubSeenFrom('polkadot:relay')).toEqual({ parents: 0, junctions: [{ Parachain: 1000 }] });
    expect(assetHubSeenFrom('polkadot:1001')).toEqual({ parents: 1, junctions: [{ Parachain: 1000 }] });
  });

  it('runs the call as Superuser, unpaid', () => {
    const call = Uint8Array.of(1, 2);
    const weight = { ref_time: 10n, proof_size: 20n };
    expect(remoteMessage(call, weight)).toEqual([
      { type: 'UnpaidExecution', value: { weight_limit: { type: 'Unlimited', value: undefined }, check_origin: undefined } },
      { type: 'Transact', value: { origin_kind: { type: 'Superuser', value: undefined }, fallback_max_weight: weight, call } },
    ]);
  });
});
