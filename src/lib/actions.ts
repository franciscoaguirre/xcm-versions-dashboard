import { REMOVED_VERSION } from './aggregate';
import { type Fix, MINIMUM_SAFE_VERSION } from './fixes';
import type { GuideLink } from './guides';
import { TARGET_RELEASE } from './sdk';
import type { ChainKey, ChainReport } from './types';

export interface ActionItem {
  title: string;
  detail: string;
  guide?: GuideLink;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const listNames = (keys: (ChainKey | null)[], nameOf: (key: ChainKey | null) => string) => {
  const names = keys.map(nameOf);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

/** What a chain's team has to do before XCM v3 is removed, most urgent first. Empty when nothing is needed. */
export const actionItems = (
  report: ChainReport,
  fixes: Fix[],
  nameOf: (key: ChainKey | null) => string,
): ActionItem[] => {
  const items: ActionItem[] = [];
  const { snapshot } = report;
  const reachable = snapshot?.state === 'ok';

  if (report.status === 'blocker') {
    items.push({
      title: `Upgrade the runtime to XCM v${REMOVED_VERSION + 1} or later`,
      detail:
        `${report.reason}. Once its peers run ${TARGET_RELEASE} they can no longer send it v${REMOVED_VERSION}, ` +
        `so it would be cut off from every chain. Upgrade polkadot-sdk, and migrate any v${REMOVED_VERSION} code, ` +
        `stored data and client calls.`,
      guide: { slug: 'migrating-xcm-v3-to-v4' },
    });
  }

  if (snapshot && snapshot.state === 'unreachable') {
    items.push({
      title: 'Publish a working public RPC',
      detail:
        `This dashboard couldn't read its XCM settings (${snapshot.error ?? 'RPC did not respond'}), so nobody can ` +
        'check whether it is ready. Add a working endpoint to the polkadot-js/apps endpoint list.',
    });
  }

  const own = fixes.filter((fix) => fix.holderKey === report.chain.key);
  const recordFixes = own.filter((fix) => fix.peerKey !== null);
  if (recordFixes.length) {
    const one = recordFixes.length === 1;
    items.push({
      title: `Fix ${plural(recordFixes.length, 'version record')}`,
      detail:
        `It records ${listNames(recordFixes.map((fix) => fix.peerKey), nameOf)} at v${REMOVED_VERSION} or lower, ` +
        `although ${one ? 'it speaks' : 'they speak'} v${REMOVED_VERSION + 1} or later. After ${TARGET_RELEASE}, ` +
        `messages to ${one ? 'it' : 'them'} would fail. Set ${one ? 'the record' : 'each record'} with ` +
        `${recordFixes[0].call}; the arguments and the governance call are under Records to fix below.`,
      guide: { slug: 'fixing-xcm-version-records', anchor: 'the-fix' },
    });
  }

  const fallback = own.find((fix) => fix.kind === 'fallback-version');
  if (fallback) {
    items.push({
      title: `Raise the fallback version to ${MINIMUM_SAFE_VERSION}`,
      detail:
        `SafeXcmVersion is v${fallback.recorded}, so after ${TARGET_RELEASE} messages to any destination without a ` +
        'record would fail. ' +
        `Call ${fallback.call}(${fallback.argument}).`,
      guide: { slug: 'fixing-xcm-version-records', anchor: 'why-the-fallback-should-be-4' },
    });
  }

  if (report.status !== 'blocker' && reachable) {
    const holders = report.recordedByPeers.filter((record) => record.version <= REMOVED_VERSION);
    if (holders.length) {
      items.push({
        title: 'Ask peers to refresh their record of this chain',
        detail:
          `${listNames(holders.map((record) => record.holderKey), nameOf)} still ` +
          `${holders.length === 1 ? 'records' : 'record'} it at v${REMOVED_VERSION} or lower, so after ` +
          `${TARGET_RELEASE} their messages to it would fail. The fix is a governance call on their side, listed ` +
          'in their own rows.',
        guide: { slug: 'fixing-xcm-version-records' },
      });
    }
  }

  return items;
};
