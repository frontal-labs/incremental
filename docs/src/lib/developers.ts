import { getVisibleContent } from "@/lib/content";
import type { Locale } from "@/lib/locales";
import {
  type CardSource,
  cardGroups,
  groupTitle,
  type NavItem,
  type NavLink,
  nav,
  neighbors,
  type ReferenceCard,
  type ReferenceCardGroup,
} from "@/lib/nav";
import { developersSource } from "@/lib/sources";

/** Matches `getVisibleContent`'s own default. */
const DEFAULT_LOCALE: Locale = "en";

/**
 * The developer reference's navigation.
 *
 * The developer reference uses the shared page-tree walk in `@/lib/nav`.
 */
export const devNav = (locale: Locale = DEFAULT_LOCALE): NavItem[] =>
  nav(developersSource.getPageTree(locale));

/** The group a page sits in, or `undefined` when it is a row of its own. */
export const devGroup = (
  url: string,
  locale: Locale = DEFAULT_LOCALE
): string | undefined => groupTitle(devNav(locale), url);

const cardSources = (locale: Locale): Map<string, CardSource> =>
  new Map(
    devPages(locale).map((page) => [
      page.slugs.length > 0 ? `/${page.slugs.join("/")}` : "/",
     { description: page.data.description, icon: page.data.icon },
   ])
 );

/** The index's card groups: one per sidebar row, in the same order. */
export const devCards = (
  locale: Locale = DEFAULT_LOCALE
): ReferenceCardGroup[] =>
  cardGroups(devNav(locale), cardSources(locale));

/** The pages marked `featured`, in navigation order, for the index's lead row. */
export function devFeatured(
  locale: Locale = DEFAULT_LOCALE,
  limit = 4
): ReferenceCard[] {
  const featured = new Set(
    devPages(locale)
      .filter((page) => page.data.featured)
      .map((page) =>
        page.slugs.length > 0 ? `/${page.slugs.join("/")}` : "/"
      )
  );

  return devCards(locale)
    .flatMap((group) => group.cards)
    .filter((card) => featured.has(card.url))
    .slice(0, limit);
}

/** The pages either side of `url`, for the footer pager. */
export const devNeighbors = (
  url: string,
  locale: Locale = DEFAULT_LOCALE
): { next?: NavLink; previous?: NavLink } =>
  neighbors(devNav(locale), url);

/** One reference page by its URL slugs, honouring publication windows. */
export const devPage = (
  slugs: readonly string[],
  locale: Locale = DEFAULT_LOCALE
) =>
  getVisibleContent(developersSource.getPages(), { locale }).find(
    (page) => page.slugs.join("/") === slugs.join("/")
  );

/** Every visible reference page, for static params and the search index. */
export const devPages = (locale: Locale = DEFAULT_LOCALE) =>
  getVisibleContent(developersSource.getPages(), { locale });
