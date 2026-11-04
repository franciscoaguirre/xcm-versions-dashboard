# Fixing XCM version records before stable2612

polkadot-sdk **stable2612** removes XCM v3. A chain on stable2612 can no longer encode a message as v3. So any setting that makes it pick v3 (or v2) for a destination stops that message from being sent, even when the destination speaks v5.

This guide is for teams whose chain has **Records to fix** when you expand it on the dashboard. It explains where a chain gets its version settings, and the governance calls that fix them.

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

Expand a chain on the dashboard: its *Records to fix* table lists both calls, with the arguments ready to paste. The pallet is called `xcmPallet` on relay chains and `polkadotXcm` on most parachains.

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

With PAPI, the type names come from your chain's generated descriptors and can differ slightly between chains. On a relay chain the pallet is `XcmPallet` (PAPI) or `xcmPallet` (PJS). The dashboard's *Records to fix* tables give each location in the PJS format, which is also what the polkadot.js apps extrinsic form accepts.

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

## Ready-made calls

Under each chain's *Records to fix*, **Prepare call data** turns its fixes into call data ready to note as a preimage; `pnpm governance-calls` in this repository does it for every chain at once. Each call is encoded against the chain's live metadata and dry-run as Root before you see it.

- **Your own chain**: one call, or a `utility.batchAll` of every fix, for your chain's governance.
- **The relay chain and system chains** (para IDs below 2000): one referendum per relay, on Asset Hub, where governance lives since the Asset Hub migration. It applies Asset Hub's own fixes first, then sends each other system chain its fixes:

```text
utility.batchAll([
  polkadotXcm.forceXcmVersion(...),            // Asset Hub's own fixes
  polkadotXcm.send(dest: relay or sibling, V5 [
    UnpaidExecution { weight_limit: Unlimited },
    Transact { origin_kind: Superuser, fallback_max_weight, call: <that chain's batch> },
  ]),
  ...one send per system chain
])
```

System chains accept Superuser from Asset Hub and execute its messages for free. `fallback_max_weight` is twice the call's measured weight, and only matters if the message has to be downgraded to v4. Asset Hub's fixes come first, so the sends already use its corrected records. The dry run executes the whole batch on Asset Hub, then each forwarded message on its destination, and checks that every record was set.

## Entries stored under a v3 key

This only matters when your chain upgrades to stable2612. Until then nothing changes: the runtime still decodes these entries, and messages to and from your chain are unaffected. Take care of it while preparing that upgrade.

The *key* of a version record is a separate problem from its *value*. `SupportedVersion`, `VersionNotifiers` (the subscriptions your chain made to others) and `VersionNotifyTargets` (others' subscriptions to your chain) are all keyed by two things: the XCM version the location was encoded with, and the location as a `VersionedLocation`. Entries written while your runtime was on v3 sit under key version `3` with a `VersionedLocation::V3`, whatever version they record.

pallet-xcm moves such entries to the current key version with a lazy migration that runs over several blocks. That migration only runs when something starts it, so on some chains old entries are still under v3 keys. A runtime on stable2612 can't decode a `V3` location anymore, so after that upgrade the migration can't move these entries. Records left there are never read, and subscriptions left there are lost: your chain stops telling those peers when its version changes, and stops hearing from them.

So run the migration in a runtime upgrade on a release before stable2612, while the runtime can still decode v3:

```rust
pub type Migrations = (
    // ...
    pallet_xcm::migration::MigrateToLatestXcmVersion<Runtime>,
);
```

It can stay in your migrations permanently. It starts the lazy migration, which re-keys all three maps under the current version in `on_initialize`. Once `CurrentMigration` reads `None` again, the migration is done and the entries below show up under key version `5`.

The dashboard lists any entries left under a v3 key in each chain's *Storage under v3 keys* section. To check yourself, read each map's entries under key version `3` (and `2`, on very old chains):

```ts tab=papi
const supported = await api.query.PolkadotXcm.SupportedVersion.getEntries(3);
const notifiers = await api.query.PolkadotXcm.VersionNotifiers.getEntries(3);
const targets = await api.query.PolkadotXcm.VersionNotifyTargets.getEntries(3);
const migrating = await api.query.PolkadotXcm.CurrentMigration.getValue(); // undefined once done
```

```js tab=pjs
const supported = await api.query.polkadotXcm.supportedVersion.entries(3);
const notifiers = await api.query.polkadotXcm.versionNotifiers.entries(3);
const targets = await api.query.polkadotXcm.versionNotifyTargets.entries(3);
const migrating = await api.query.polkadotXcm.currentMigration(); // None once done
```

All three should be empty.

## Checking your chain's state

Both are storage items of the XCM pallet. `SupportedVersion` is keyed by the XCM version used to encode the location (`5` on current runtimes) and by the versioned location. An entry under an older key version is a leftover that the runtime no longer reads (see [Entries stored under a v3 key](#entries-stored-under-a-v3-key)). `SafeXcmVersion` is the fallback version.

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
