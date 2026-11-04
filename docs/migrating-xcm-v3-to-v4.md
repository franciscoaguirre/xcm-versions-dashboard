# Migrating XCM v3 code to v4

polkadot-sdk **stable2612** removes XCM v3. Runtimes built on it can't encode or decode v3 messages, locations or assets. Anything that still builds, stores or submits v3 has to move to v4 or later first:

- runtime code that constructs or matches XCM types;
- on-chain storage that holds XCM types;
- clients (wallets, dApps, bridges, scripts) that submit extrinsics with `V3` arguments.

This guide covers each of them. Every type and conversion below was checked against the `staging-xcm` crate in `polkadot-stable2609`.

## v4 or v5?

v5 is the latest version and the one current runtimes use. The changes in this guide are what it takes to leave v3. v4 programs convert to v5 automatically, so v4 is enough to keep working after stable2612. If you're touching the code anyway, consider writing against `xcm::v5` so the next removal doesn't require another migration.

Import a numbered version (`xcm::v4` or `xcm::v5`) rather than `xcm::latest`. `latest` silently points at a new version when you upgrade polkadot-sdk, changing types under code that was written and tested against the previous one. With an explicit version, moving to the next one is a deliberate change.

## What changes from v3 to v4

v4 has the same 48 instructions as v3, with the same fields. What changes is the types around them:

| v3 | v4 |
|---|---|
| `MultiLocation` | `Location` |
| `InteriorMultiLocation` | `InteriorLocation` (an alias of `Junctions`) |
| `MultiAsset` | `Asset` |
| `MultiAssets` | `Assets` |
| `MultiAssetFilter` | `AssetFilter` |
| `WildMultiAsset` | `WildAsset` |
| `AssetId::Concrete(location)` | `AssetId(location)` |
| `AssetId::Abstract([u8; 32])` | **Removed**; there is no v4 equivalent |
| `Junctions::X1(Junction)`, `X2(Junction, Junction)`, … | `Junctions::X1(Arc<[Junction; 1]>)`, `X2(Arc<[Junction; 2]>)`, … |
| `VersionedMultiLocation` | `VersionedLocation` |
| `VersionedMultiAssets` | `VersionedAssets` |
| `VersionedMultiAsset` | `VersionedAsset` |

## Runtime code

### Imports

```rust
// Before
use xcm::v3::prelude::*;
// After
use xcm::v4::prelude::*; // or xcm::v5::prelude::*
```

### Building locations

Junctions are now arrays, and `Location::new` takes anything that converts into `Junctions`, including an array of junctions:

```rust
// v3
let asset_hub = MultiLocation::new(1, X1(Parachain(1000)));
let usdt = MultiLocation::new(1, X3(Parachain(1000), PalletInstance(50), GeneralIndex(1984)));

// v4
let asset_hub = Location::new(1, [Parachain(1000)]);
let usdt = Location::new(1, [Parachain(1000), PalletInstance(50), GeneralIndex(1984)]);
```

### Matching on locations

The `X1(Arc<[Junction; 1]>)` shape can't be matched the way v3 tuples could. Match on `unpack()`, which returns the parents and the junctions as a slice:

```rust
// v3
match location {
    MultiLocation { parents: 1, interior: X1(Parachain(id)) } => Some(id),
    _ => None,
}

// v4
match location.unpack() {
    (1, [Parachain(id)]) => Some(*id),
    _ => None,
}
```

`first_interior()`, `interior().as_slice()`, `push_interior()` and `pushed_with_interior()` cover most other uses.

### Assets

`AssetId` is now a plain wrapper around a `Location`:

```rust
// v3
let id = AssetId::Concrete(MultiLocation::new(1, Here));
let fee: MultiAsset = (id, 1_000_000_000u128).into();

// v4
let id = AssetId(Location::new(1, Here));
let fee: Asset = (id, 1_000_000_000u128).into();
```

**Abstract asset IDs are gone.** Converting a v3 `AssetId::Abstract` (or any asset or filter containing one) to v4 fails. If your chain identifies assets by an abstract ID, give each one a location under your chain first, such as `[PalletInstance(n), GeneralIndex(i)]` or `[GeneralKey { .. }]`, and agree on it with every chain that holds the asset.

### Programs

Programs keep their instructions; only the types change. A typical v3 transfer program:

```rust
use xcm::v3::prelude::*;

let fees: MultiAsset = (AssetId::Concrete(MultiLocation::parent()), 1_000_000_000u128).into();
let message: Xcm<()> = Xcm(vec![
    WithdrawAsset(fees.clone().into()),
    BuyExecution { fees, weight_limit: Unlimited },
    DepositAsset {
        assets: Wild(AllCounted(1)),
        beneficiary: MultiLocation::new(0, X1(AccountId32 { network: None, id: account })),
    },
]);
```

becomes in v4:

```rust
use xcm::v4::prelude::*;

let fees: Asset = (AssetId(Location::parent()), 1_000_000_000u128).into();
let message: Xcm<()> = Xcm(vec![
    WithdrawAsset(fees.clone().into()),
    BuyExecution { fees, weight_limit: Unlimited },
    DepositAsset {
        assets: Wild(AllCounted(1)),
        beneficiary: Location::new(0, [AccountId32 { network: None, id: account }]),
    },
]);
```

### Converting existing values

v4 types convert from v3 with `TryFrom`, and the versioned wrappers convert between versions:

```rust
let location: xcm::v4::Location = old_location.try_into()?; // v3 MultiLocation -> v4
let asset: xcm::v4::Asset = old_asset.try_into()?;          // fails for Abstract IDs
let versioned = VersionedLocation::from(location);           // wraps it as VersionedLocation::V4
let location_v5: xcm::v5::Location = versioned.try_into()?;  // any supported version -> v5
```

`VersionedXcm::into_version(n)` converts a whole message. After stable2612, `into_version(3)` always fails, which is why version records still set to v3 stop messages from being sent (see [Fixing XCM version records](fixing-xcm-version-records.md)).

## Stored data

Check every storage item, event and runtime API type that holds an XCM type. The SCALE encodings were compared using Polkadot's own metadata:

- **Locations encode identically in v3, v4 and v5.** For example, `{ parents: 1, interior: X2(Parachain(1000), GeneralIndex(1984)) }` is `0x010200a10f05011f` in all three. Storage of a bare `MultiLocation` can be re-typed as `Location` without migrating the data.
- **Asset IDs don't.** A v3 `AssetId` starts with a variant byte (`0x00` for `Concrete`) that v4's `AssetId` doesn't have. The same goes for anything containing one: `MultiAsset`, `MultiAssets`, filters. Storage holding these needs a migration that decodes v3 and re-encodes v4. A common example is an asset registry keyed by v3 `AssetId` or `MultiAsset`.
- **Versioned types** (`VersionedLocation`, `VersionedAssets`, `VersionedXcm`) store a version byte (3, 4 or 5) in front. Entries stored as `V3` must be rewritten as `V4` or `V5` before the v3 variant disappears, or they will no longer decode. This includes storage *keys*: pallet-xcm's own version maps need `MigrateToLatestXcmVersion` (see [Entries stored under a v3 key](fixing-xcm-version-records.md#entries-stored-under-a-v3-key)).

## Clients

Extrinsics and runtime APIs take versioned arguments. A client that sends `V3` values will have them rejected once the chain runs stable2612. Switch the variant and adjust the shape:

```ts tab=papi
import {
  XcmV3Junction,
  XcmV3Junctions,
  XcmV3MultiassetAssetId,
  XcmV3MultiassetFungibility,
  XcmV5Junction,
  XcmV5Junctions,
  XcmVersionedAssets,
  XcmVersionedLocation,
} from '@polkadot-api/descriptors';

// v3
const dest = XcmVersionedLocation.V3({ parents: 1, interior: XcmV3Junctions.X1(XcmV3Junction.Parachain(1000)) });
const assets = XcmVersionedAssets.V3([
  {
    id: XcmV3MultiassetAssetId.Concrete({ parents: 1, interior: XcmV3Junctions.Here() }),
    fun: XcmV3MultiassetFungibility.Fungible(10_000_000_000n),
  },
]);

// v5 (v4 has the same shape; use V4 where the chain doesn't support v5)
const dest = XcmVersionedLocation.V5({ parents: 1, interior: XcmV5Junctions.X1(XcmV5Junction.Parachain(1000)) });
const assets = XcmVersionedAssets.V5([
  { id: { parents: 1, interior: XcmV5Junctions.Here() }, fun: XcmV3MultiassetFungibility.Fungible(10_000_000_000n) },
]);
```

```js tab=pjs
// v3
const dest = { V3: { parents: 1, interior: { X1: { Parachain: 1000 } } } };
const assets = { V3: [{ id: { Concrete: { parents: 1, interior: 'Here' } }, fun: { Fungible: 10_000_000_000n } }] };

// v4 (v5 has the same shape; use V5 where the chain supports it)
const dest = { V4: { parents: 1, interior: { X1: [{ Parachain: 1000 }] } } };
const assets = { V4: [{ id: { parents: 1, interior: 'Here' }, fun: { Fungible: 10_000_000_000n } }] };
```

The two differences are the junction types inside `X1`…`X8` (in PJS, `X1` now holds an array), and asset IDs, which are locations without the `Concrete` wrapper. With PAPI, the type names come from your chain's generated descriptors and can differ slightly between chains; the type checker points at every field whose shape changed.

## Checklist

1. Search the codebase for `v3::`, `MultiLocation`, `MultiAsset`, `Concrete`, `Abstract` and `VersionedMulti`.
2. Move imports to `xcm::v4` or `xcm::v5` (not `xcm::latest`), and fix the compiler errors using the tables above.
3. Find every storage item holding v3 asset types or `V3` versioned values, and write migrations for them.
4. Update client code that submits `V3` arguments.
5. Fix your chain's version records and raise `SafeXcmVersion` to at least 4 ([guide](fixing-xcm-version-records.md)).
6. Test real messages against a fork of mainnet, for example with Chopsticks, and use the `DryRunApi` runtime API to check what a call or message does before sending it.
