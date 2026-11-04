# XCM Versions

A dashboard of every live Polkadot and Kusama chain and the XCM version it speaks, for planning the removal of XCM v3 in polkadot-sdk **stable2612**.

**Live dashboard: <https://franciscoaguirre.github.io/xcm-versions-dashboard/>**

The main risk is a chain whose highest XCM version is v3 or lower: once v3 is removed, it can't exchange XCM with anyone. The dashboard puts those chains first and shows what each team needs to know: what their runtime can encode, what their peers have recorded for them, and which polkadot-sdk release their source builds against.

## Migration guides

The dashboard serves both guides itself (at `?guide=<name>`), rendered from `docs/` at build time, and links to them from each chain's action items.

- **[Fixing XCM version records](docs/fixing-xcm-version-records.md)**: why some chains would still send v3 to peers that speak v5, and the governance calls that fix their records.
- **[Migrating XCM v3 code to v4](docs/migrating-xcm-v3-to-v4.md)**: type changes, stored data and client code, with before-and-after examples.

## Running it

Requires Node 22.12+ and pnpm. The exact pnpm version is pinned in `package.json` (`packageManager`), and Corepack downloads it automatically.

```sh
pnpm install
pnpm dev           # http://localhost:5173
pnpm build         # static site in dist/, deployable anywhere (relative paths)
pnpm test
```

`npm install` is deliberately blocked; see [Supply-chain security](#supply-chain-security).

`pnpm-workspace.yaml` also installs the macOS and Linux arm64 native binaries (`supportedArchitectures`), so a `node_modules` folder can be shared between a macOS host and a Linux container. Your own platform is always included, so you can leave it as is or trim the list.

Everything is read live from public RPC endpoints in the browser. A full check of about 74 chains takes around a minute.

## How chains are classified

**Which chains are listed.** For each relay, the dashboard lists every para whose head was included in the last 365 days, using `Paras.MostRecentContext`. A para counts as *active* if it produced a block in the last 7 days. Otherwise it's *stalled*, and stalled chains are hidden unless you tick the filter. `Paras.Parachains` can't be used for this: since coretime, almost every para is a lease-less "Parathread".

**What is read from each chain.** All of this comes from the XCM pallet (`PolkadotXcm` or `XcmPallet`, whichever the metadata names), at the finalized block:

| Read | Meaning |
|---|---|
| Highest `VersionedXcm` variant in metadata | What the runtime can encode at all |
| `VersionNotifyTargets` (last field of the value) | The version the chain advertised to each subscriber |
| `SupportedVersion` | The version the chain believes each of its peers supports |
| `SafeXcmVersion` | The fallback version for destinations with no record |

**What each status means.**

| Status | Meaning | Who to contact |
|---|---|---|
| Blocker | Speaks XCM v3 or lower: its metadata or advertised version is ≤ 3 | That chain's team |
| Recorded at v3 | Upgraded, but some peer's `SupportedVersion` still holds it at v3 | The peers listed in the expanded row, or re-trigger version discovery |
| Holds v3 records | Its own `SupportedVersion` holds an upgraded peer at v3, or its fallback `SafeXcmVersion` is v3 or lower | That chain's team |
| Unreachable | No working public RPC. If every peer record says ≤ 3, it is shown as a Blocker instead | Find an RPC (see below) |

**Action items.** Expanding a chain shows what its team needs to do, most urgent first: upgrade a runtime that speaks only v3 or lower, fix its own stale records and fallback version, ask peers to refresh their records of it, or publish a working RPC. Each item links to the relevant guide.

**Records to fix.** Expanding a chain also lists its settings that would still make it send v3 or lower: records holding an upgraded peer at v3, and a `SafeXcmVersion` fallback of v3 or lower. Each row gives the call that fixes it and the arguments to pass: `forceXcmVersion` sets a stale record to the version the peer speaks, and `forceDefaultXcmVersion` raises the fallback version. The [guide](docs/fixing-xcm-version-records.md) explains how to write and batch the calls. Records at v3 or lower that no call should change are listed under *Left as is*, each with the reason: the peer only speaks v3, its version is unknown, or it stopped producing blocks.

**Chain pages.** Each chain also has its own page at `?chain=<relay>:<paraId>` (or `?chain=<relay>:relay`), opened from the link icon next to its name, to send a team just their chain. It still reads every chain first, since what peers record for it lives in their storage.

**Governance calls.** Below a chain's records, **Prepare call data** builds the referendum that applies them: encoded against the live runtime, with its preimage hash, a polkadot.js apps decode link, and a dry run as Root. The relay chain and system chains (para IDs below 2000) share one referendum per relay, submitted on Asset Hub, which sends each system chain its fixes as a Superuser `Transact`; expanding any of them, or Asset Hub, shows that shared proposal. Every other chain gets one call. `pnpm governance-calls` does the same for every chain from Node and writes every proposal to `exports/governance/`; it exits non-zero if a proposal can't be prepared or fails its dry run.

Collection uses plain request/response legacy RPC calls (`state_getKeysPaged`, `state_queryStorageAt` and so on), decoded with PAPI's metadata-driven codecs. It deliberately avoids subscriptions: some legacy parachain nodes never push finalized-head notifications. Nodes that report genesis as finalized (unsynced) are skipped in favour of the next endpoint.

## Data files

| File | What it is | How to update |
|---|---|---|
| `src/data/chains.json` | Names, para IDs, homepages and RPCs, from polkadot-js/apps' endpoint lists | `pnpm sync-chains [git-ref]` (defaults to the current master commit) |
| `src/data/chains-source.json` | The polkadot-js/apps commit `chains.json` was built from | Written by `pnpm sync-chains` |
| `src/data/extra-endpoints.json` | Verified RPCs that polkadot-js/apps lacks | Check with `pnpm verify-endpoint <para-id> <wss-url>`, then add |
| `src/data/repos.json` | Each chain's source repo, lockfile path and runtime crate hint | Edit by hand |
| `src/data/sdk-versions.json` | polkadot-sdk release resolved from each repo's `Cargo.lock` | `pnpm fetch-sdk` (set `GITHUB_TOKEN` to also record commit dates) |
| `src/data/sdk-releases.json` | `staging-xcm` version mapped to polkadot-sdk release | Written by `pnpm fetch-sdk` |
| `src/data/contacts.json` | Your outreach contacts | Edit by hand (see below) |

### Contacts

Contacts are keyed by chain (`<relay>:<paraId>` or `<relay>:relay`):

```json
{
  "polkadot:2094": { "team": "Pendulum", "contact": "@someone on Element", "notes": "Asked about upgrade on 2026-10-30" }
}
```

### SDK release caveats

- The release is read from the repository's **default branch**, which can be ahead of or behind the runtime actually deployed. The dashboard shows the on-chain spec version next to it.
- "(unconfirmed)" means the lockfile has no runtime crate matching the chain, so the repository match itself may be wrong. Bifrost is an example: its public repo is the node only.
- Releases come from the `branch`/`tag` of a polkadot-sdk git dependency where there is one, and otherwise from the `staging-xcm` crate version. Pre-monorepo chains are matched through the old `xcm` crate on `paritytech/polkadot` `release-v0.9.x` branches.
- The chain-to-repository mapping in `src/data/repos.json` is best-effort. If your chain's repository is missing or wrong, a correction is welcome.

## Snapshot export

For places that can't query chains live, such as a static report or a page without WebSocket access, export a snapshot:

```sh
pnpm export-dashboard   # writes exports/chains.json and exports/version-records.json
```

`chains.json` has one row per chain with display-ready columns. `version-records.json` has every `SupportedVersion` entry across all chains, with what each peer last announced to the holder.

## Command-line snapshot

```sh
pnpm snapshot reports.json
```

Runs the same collection from Node, prints a summary with every blocker, and writes the full reports to `reports.json`.

## Supply-chain security

The settings live in `pnpm-workspace.yaml`, `.npmrc` and `package.json`.

| Mitigation | Where | What it does |
|---|---|---|
| Release-age delay | `minimumReleaseAge: 10080`, `minimumReleaseAgeStrict: true` | Only versions published at least 7 days ago are installed. Most malicious releases are pulled within that window. Installs fail rather than silently picking another version. |
| Trust downgrade check | `trustPolicy: no-downgrade` | Fails when a package version has weaker publishing trust (for example, no provenance) than its earlier releases. That is a common sign of a hijacked maintainer account. |
| No exotic transitive sources | `blockExoticSubdeps: true` | Transitive dependencies must come from the registry, not from git or tarball URLs. |
| Install scripts blocked | `strictDepBuilds: true`, `allowBuilds` | No dependency lifecycle script runs unless it is approved, and an unreviewed one fails the install. The only one in the tree, esbuild's postinstall, is denied because it isn't needed. |
| Exact versions | `package.json`, `savePrefix: ''` | Direct dependencies are pinned exactly, and `pnpm add` saves exact versions. |
| Lockfile | `pnpm-lock.yaml` | Commit it. In CI, `pnpm install` runs with `--frozen-lockfile` by default. Lockfile entries are re-checked against the release-age and trust policies on every install. |
| Pinned pnpm | `packageManager: pnpm@<version>` | Everyone uses the same pnpm, and the pin is subject to the same policies. |
| Pinned registry | `.npmrc` | Packages come only from registry.npmjs.org. |
| npm blocked | `engines.npm` + `engine-strict` | `npm install` fails, so nobody bypasses the policies by accident. |
| Small dependency tree | | About 78 packages. The guides are rendered with `marked` and their code highlighted with `highlight.js` (neither has dependencies of its own) at build time, so neither ships to the browser. `sync-chains` reads polkadot-js/apps source statically instead of installing `@polkadot/apps-config`, which would add about 750 packages. |

### Working with the policies

- **Adding or upgrading a package.** If the version you want is younger than 7 days, the install fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. Pick an older version or wait. For an urgent security fix, add that exact version to `minimumReleaseAgeExclude` and remove it once it has matured.
- **A new dependency with an install script.** The install fails with `ERR_PNPM_IGNORED_BUILDS`. Read the script, then set the package to `true` or `false` under `allowBuilds`.
- **A trust-policy failure.** Investigate before excluding anything: check the package's release history and its maintainers. If the downgrade is legitimate, add that exact version to `trustPolicyExclude`.
- **Upgrading pnpm.** Run `pnpm self-update <version>`, choosing a version at least 7 days old.
- **Auditing.** Run `pnpm audit` regularly, and in CI.

## Security

This is unaudited reference tooling. It only reads public chain state over public RPC endpoints: it holds no keys and submits no transactions. The governance calls suggested in the dashboard and in the [version records guide](docs/fixing-xcm-version-records.md) change live chains, so review them, and test them against a fork of the chain (for example with Chopsticks), before proposing them.

## License

[Apache-2.0](LICENSE)
