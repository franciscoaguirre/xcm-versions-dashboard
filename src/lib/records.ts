import { REMOVED_VERSION } from './aggregate';
import { type LocationContext, resolveLocation } from './location';
import type { LegacyKeyedEntry, VersionKeyedMap, VersionRecord } from './types';

/**
 * pallet-xcm keys `SupportedVersion` by (location encoding version, location) and looks
 * records up under the current encoding, so after an XCM version migration a location can
 * also have a leftover entry under an older key. Keep only the newest per location.
 */
export const latestPerLocation = (records: VersionRecord[]): VersionRecord[] => {
  const latest = new Map<string, VersionRecord>();
  for (const record of records) {
    const current = latest.get(record.peerLabel);
    if (!current || (record.keyVersion ?? 0) > (current.keyVersion ?? 0)) latest.set(record.peerLabel, record);
  }
  return [...latest.values()];
};

/** `V3` -> 3. */
const variantVersion = (location: unknown) => Number((location as { type: string }).type.replace(/^V/, ''));

/**
 * Entries of a `(XcmVersion, VersionedLocation)`-keyed map whose key still uses v3 or lower,
 * in the version prefix or the location variant. Once v3 is removed these keys can't be decoded,
 * so pallet-xcm's version migration can no longer move them.
 */
export const legacyKeyedEntries = (
  map: VersionKeyedMap,
  entries: { keyArgs: unknown[] }[],
  context: LocationContext,
): LegacyKeyedEntry[] =>
  entries.flatMap(({ keyArgs: [keyVersion, location] }) => {
    const locationVersion = variantVersion(location);
    if ((keyVersion as number) > REMOVED_VERSION && locationVersion > REMOVED_VERSION) return [];
    return [{ map, ...resolveLocation(location, context), keyVersion: keyVersion as number, locationVersion }];
  });

/** Hex characters of a byte range in a `0x`-prefixed storage key. */
const keyBytes = (key: string, offset: number, length: number) => key.slice(2 + offset * 2, 2 + (offset + length) * 2);

/**
 * A version-keyed entry whose key the runtime metadata can't decode, typically a `V3` location
 * on a runtime that no longer has the variant. The key is
 * `twox128(pallet) ++ twox128(map) ++ twox64(version) ++ version ++ blake2_128(location) ++ location`,
 * so both versions can still be read from the raw bytes.
 */
export const undecodableLegacyEntry = (map: VersionKeyedMap, key: string): LegacyKeyedEntry => {
  const keyVersion = Number.parseInt(keyBytes(key, 40, 4).match(/../g)!.reverse().join(''), 16);
  const locationVersion = Number.parseInt(keyBytes(key, 60, 1), 16);
  return { map, peerKey: null, peerLabel: 'Undecodable location', keyVersion, locationVersion };
};
