import type { VersionRecord } from './types';

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
