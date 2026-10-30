export const GUIDES = {
  'fixing-xcm-version-records': 'Fixing XCM version records',
  'migrating-xcm-v3-to-v4': 'Migrating XCM v3 code to v4',
} as const;

export type GuideSlug = keyof typeof GUIDES;

export interface GuideLink {
  slug: GuideSlug;
  /** A heading anchor inside the guide. */
  anchor?: string;
}

export const isGuideSlug = (value: string | null): value is GuideSlug => value !== null && value in GUIDES;

/** Guides are served by the same page: `?guide=<slug>#<anchor>`. */
export const guideHref = ({ slug, anchor }: GuideLink) => `?guide=${slug}${anchor ? `#${anchor}` : ''}`;
