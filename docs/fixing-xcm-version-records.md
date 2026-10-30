# Fixing XCM version records before stable2612

polkadot-sdk **stable2612** removes XCM v3. A chain on stable2612 can no longer encode a message as v3. So any setting that makes it pick v3 (or v2) for a destination stops that message from being sent, even when the destination speaks v5.

This guide is for teams whose chain shows up in the **Records to fix** section of the dashboard. It explains where a chain gets its version settings, and the governance calls that fix them.

## How a chain picks the XCM version for a message

When pallet-xcm sends a message to a destination, it picks the version in this order:

1. **The destination's record** in `SupportedVersion`, the version the chain believes that destination supports.
2. **Otherwise, the fallback version** in `SafeXcmVersion`.

The message is then encoded at the lower of that version and the chain's own XCM version. If that fails, the router rejects the message with `DestinationUnsupported`. After stable2612 removes v3, that happens whenever the record or the fallback is v3 or lower.

A record stays as it is until something overwrites it: a governance call, or a version announcement from a peer the chain is subscribed to. Many records were written years ago, when the peer still spoke v3, and nothing has updated them since.

## The fix

Set each stale record directly, in a governance call from the chain's `AdminOrigin`. That is Root on most chains, so in practice it's a referendum.

| Problem | Call |
|---|---|
| A record holds a peer at v3 or lower, but the peer speaks v4 or later | `forceXcmVersion(location, version)`, with the version the peer speaks |
| `SafeXcmVersion` is v3 or lower | `forceDefaultXcmVersion(Some(4))` |

The dashboard's *Records to fix* table lists both calls for every chain, with the arguments ready to paste. The pallet is called `xcmPallet` on relay chains and `polkadotXcm` on most parachains.

### Why the fallback should be 4

`SafeXcmVersion` is used for every destination your chain has no record for. Once v3 is gone, every chain that can still exchange messages speaks at least v4, so 4 is the highest fallback that every such destination can decode. Set it to 5 only if you know every destination your chain might message without a record speaks v5.

## Writing the calls

`forceXcmVersion` takes the peer's **plain (unversioned) location**, written from your chain's point of view, and the version number. `forceDefaultXcmVersion` takes an optional version.

```ts tab=papi
import { XcmV5Junction, XcmV5Junctions } from '@polkadot-api/descriptors';

// A parachain's relay chain
const relay = { parents: 1, interior: XcmV5Junctions.Here() };
// Sibling parachain 2034, seen from a parachain
const sibling = { parents: 1, interior: XcmV5Junctions.X1(XcmV5Junction.Parachain(2034)) };
// Parachain 2034, seen from its relay chain
const child = { parents: 0, interior: XcmV5Junctions.X1(XcmV5Junction.Parachain(2034)) };

api.tx.PolkadotXcm.force_xcm_version({ location: sibling, version: 5 });
api.tx.PolkadotXcm.force_default_xcm_version({ maybe_xcm_version: 4 });
```

```js tab=pjs
// A parachain's relay chain
const relay = { parents: 1, interior: 'Here' };
// Sibling parachain 2034, seen from a parachain
const sibling = { parents: 1, interior: { X1: [{ Parachain: 2034 }] } };
// Parachain 2034, seen from its relay chain
const child = { parents: 0, interior: { X1: [{ Parachain: 2034 }] } };

api.tx.polkadotXcm.forceXcmVersion(sibling, 5);
api.tx.polkadotXcm.forceDefaultXcmVersion(4);
```

With PAPI, the type names come from your chain's generated descriptors and can differ slightly between chains. On a relay chain the pallet is `XcmPallet` (PAPI) or `xcmPallet` (PJS). The *Records to fix* table on the dashboard gives each location in the PJS format, which is also what the polkadot.js apps extrinsic form accepts.

### Batching

A chain with several records to fix can submit everything in one referendum with `utility.batchAll`. These calls only fail if the origin is wrong, so a batch either applies everything or nothing.

Example for a parachain that records Asset Hub (para 1000) and Hydration (para 2034) at v3 although both speak v5, and whose fallback is v3:

```ts tab=papi
import { XcmV5Junction, XcmV5Junctions } from '@polkadot-api/descriptors';

const assetHub = { parents: 1, interior: XcmV5Junctions.X1(XcmV5Junction.Parachain(1000)) };
const hydration = { parents: 1, interior: XcmV5Junctions.X1(XcmV5Junction.Parachain(2034)) };

const batch = api.tx.Utility.batch_all({
  calls: [
    api.tx.PolkadotXcm.force_xcm_version({ location: assetHub, version: 5 }).decodedCall,
    api.tx.PolkadotXcm.force_xcm_version({ location: hydration, version: 5 }).decodedCall,
    api.tx.PolkadotXcm.force_default_xcm_version({ maybe_xcm_version: 4 }).decodedCall,
  ],
});

// The call data to note as a preimage and submit to governance
const callData = (await batch.getEncodedData()).asHex();
```

```js tab=pjs
const batch = api.tx.utility.batchAll([
  api.tx.polkadotXcm.forceXcmVersion({ parents: 1, interior: { X1: [{ Parachain: 1000 }] } }, 5),
  api.tx.polkadotXcm.forceXcmVersion({ parents: 1, interior: { X1: [{ Parachain: 2034 }] } }, 5),
  api.tx.polkadotXcm.forceDefaultXcmVersion(4),
]);

// The call data to note as a preimage and submit to governance
const callData = batch.method.toHex();
```

## Checking your chain's state

Both are storage items of the XCM pallet. `SupportedVersion` is keyed by the XCM version used to encode the location (`5` on current runtimes) and by the versioned location. `SafeXcmVersion` is the fallback version.

```ts tab=papi
import { XcmVersionedLocation } from '@polkadot-api/descriptors';

const version = await api.query.PolkadotXcm.SupportedVersion.getValue(5, XcmVersionedLocation.V5(sibling));
const fallback = await api.query.PolkadotXcm.SafeXcmVersion.getValue();
```

```js tab=pjs
const version = await api.query.polkadotXcm.supportedVersion(5, { V5: sibling });
const fallback = await api.query.polkadotXcm.safeXcmVersion();
```

## Checking that it worked

When the referendum is enacted, your chain emits `SupportedVersionChanged { location, version }` for each record it set. `supportedVersion` and `safeXcmVersion` show the new values straight away, and the dashboard picks up the change at its next refresh.

## Troubleshooting

- **`BadOrigin`**: the call has to come from the pallet's `AdminOrigin`, usually Root. Submit it through your chain's governance, not from a regular account.
- **The record in the dashboard didn't change**: check the location is written from your chain's point of view. A sibling is `parents: 1`, a relay chain's own parachain is `parents: 0`. A wrong location creates a new record instead of overwriting the stale one.
- **Messages still fail after the fix**: check that the HRMP channel between the two chains is open in both directions, and that the destination accepts the message. The version is only one of the things a message needs.
