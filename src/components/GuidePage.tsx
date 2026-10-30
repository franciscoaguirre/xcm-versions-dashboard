import { ArrowLeft } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, useEffect } from 'react';
import fixingRecords from '../../docs/fixing-xcm-version-records.md';
import migratingV3 from '../../docs/migrating-xcm-v3-to-v4.md';
import { GUIDES, type GuideSlug } from '../lib/guides';

const HTML: Record<GuideSlug, string> = {
  'fixing-xcm-version-records': fixingRecords,
  'migrating-xcm-v3-to-v4': migratingV3,
};

/** Shows `tab` (e.g. `pjs`) in every code example on the page, so the reader picks a client library once. */
const selectTab = (article: HTMLElement, tab: string) => {
  for (const group of article.querySelectorAll('.code-tabs')) {
    if (!group.querySelector(`[role="tab"][data-tab="${tab}"]`)) continue;
    for (const button of group.querySelectorAll<HTMLElement>('[role="tab"]')) {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of group.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
      panel.hidden = panel.dataset.tab !== tab;
    }
  }
};

const onTabClick = (event: MouseEvent<HTMLElement>) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  if (button?.dataset.tab) selectTab(event.currentTarget, button.dataset.tab);
};

/** Left and right arrows move between the tabs of a group, as in the WAI-ARIA tabs pattern. */
const onTabKeyDown = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const button = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  if (!button) return;
  const tabs = [...button.parentElement!.querySelectorAll<HTMLElement>('[role="tab"]')];
  const next = tabs[(tabs.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  event.preventDefault();
  selectTab(event.currentTarget, next.dataset.tab!);
  next.focus();
};

/** One of the migration guides from `docs/`, rendered at build time and served at `?guide=<slug>`. */
export const GuidePage = ({ slug }: { slug: GuideSlug }) => {
  useEffect(() => {
    document.title = `${GUIDES[slug]} · XCM versions`;
    // The guide renders after the page loads, so the browser can't jump to the anchor by itself.
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, [slug]);

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
      <a
        href="./"
        className="inline-flex items-center gap-2 self-start text-sm font-medium text-secondary hover:text-secondary-hover transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden />
        XCM versions dashboard
      </a>
      {/* Tab buttons come from the rendered markdown, so their events are handled here by delegation. */}
      <article
        className="guide bg-surface-container rounded-container p-6 sm:p-10"
        onClick={onTabClick}
        onKeyDown={onTabKeyDown}
        dangerouslySetInnerHTML={{ __html: HTML[slug] }}
      />
    </main>
  );
};
