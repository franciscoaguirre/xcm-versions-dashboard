/** 6-second relay blocks. */
export const BLOCKS_PER_DAY = 14_400;
export const ACTIVE_WITHIN_DAYS = 7;
export const STALLED_WITHIN_DAYS = 365;

export type Activity = 'active' | 'stalled' | 'retired';

/**
 * Classify a para by how many relay blocks ago its last head was included
 * (`Paras.MostRecentContext`). `Paras.Parachains` can't be used for this: in the
 * coretime era almost every para is a lease-less "Parathread" running on bulk cores.
 */
export const classifyActivity = (blocksSinceInclusion: number): Activity => {
  if (blocksSinceInclusion < ACTIVE_WITHIN_DAYS * BLOCKS_PER_DAY) return 'active';
  if (blocksSinceInclusion < STALLED_WITHIN_DAYS * BLOCKS_PER_DAY) return 'stalled';
  return 'retired';
};
