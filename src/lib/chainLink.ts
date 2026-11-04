import type { ChainKey } from './types';

/** A chain's own page, served by the same bundle: `?chain=<relay>:<paraId>` (or `<relay>:relay`). */
export const chainHref = (key: ChainKey) => `?chain=${encodeURIComponent(key)}`;
