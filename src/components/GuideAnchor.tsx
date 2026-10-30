import type { ReactNode } from 'react';
import { GUIDES, guideHref, type GuideLink } from '../lib/guides';

/** Opens a guide in a new tab, so the dashboard keeps its collected data. */
export const GuideAnchor = ({ link, children }: { link: GuideLink; children?: ReactNode }) => (
  <a
    className="text-link hover:text-link-hover transition-colors"
    href={guideHref(link)}
    target="_blank"
    rel="noopener"
  >
    {children ?? GUIDES[link.slug]}
  </a>
);
