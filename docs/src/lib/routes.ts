import { cache } from "react";
import { siteUrls as configuredUrls } from "@/config/config";
import { getVisibleContent, type PublicationData } from "@/lib/content";
import { LOCALE_CODES, type Locale } from "@/lib/locales";
import { canonicalPath } from "@/lib/urls";

/** Static routes that are not supplied by an MDX collection. */

export type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

/**
 * One indexable page of the site, in locale-less form. `path` is always the
 * route as it appears under `src/routes/$locale`, with a leading slash and no
 * trailing slash (`/` for the home page).
 */
export interface SiteRoute {
	changeFrequency: ChangeFrequency;
	/** ISO `YYYY-MM-DD`, from content frontmatter where one exists. */
	lastModified?: string;
	/**
	 * Locales this route genuinely has *content* in — not every locale it is
	 * routable in. Every page is routable under all nine prefixes; that says
	 * nothing about whether the copy it renders is translated.
	 *
	 * Advertising a `de` alternate for a page that renders English is a hreflang
	 * violation and puts nine byte-identical URLs into one duplicate-content
	 * cluster. So a route earns extra locales only by actually being translated
	 * (see `FULLY_TRANSLATED_ROUTES`); everything else carries just `en` and its
	 * other-locale renders are noindexed rather than advertised as translations.
	 */
	locales: readonly Locale[];
	path: string;
	priority: number;
}

/** Every locale. Only for routes in `FULLY_TRANSLATED_ROUTES`. */
const ALL_LOCALES: readonly Locale[] = LOCALE_CODES;

/** English only — the default, and what the MDX collections all use. */
const EN_ONLY: readonly Locale[] = ["en"];

/**
 * Routes whose *entire* rendered surface — page body and `generateMetadata`
 * title/description — comes from locale messages rather than hardcoded
 * English literals. Only these may claim all nine hreflang alternates.
 *
 * This is deliberately an allow-list rather than a default. The site ships
 * nine locales but the large majority of `src/components/*` still render
 * English literals in every one of them, so defaulting to "all nine" made the
 * sitemap assert translations that do not exist.
 *
 * A route graduates into this set when its copy is fully extracted *and*
 * translated. `tests/unit/i18n-hreflang.test.ts` enforces the membership
 * criterion, so an entry added prematurely fails rather than silently
 * re-introducing duplicate-content hreflang.
 */
export const FULLY_TRANSLATED_ROUTES: ReadonlySet<string> = new Set([
	// Only the developers reference is fully translated
	"/",
]);

/** The locale set a static route may advertise, given its translation status. */
export const localesForRoute = (path: string): readonly Locale[] =>
	FULLY_TRANSLATED_ROUTES.has(path) ? ALL_LOCALES : EN_ONLY;

/**
 * Every static public route, mirroring the `src/routes/$locale` tree. Dynamic
 * segments are contributed by the content collections further down instead.
 *
 * `tests/unit/routes.test.ts` diffs this list against the router on every
 * run, so a page added or removed without a matching entry fails the build
 * rather than silently dropping out of the sitemap.
 */
export const STATIC_ROUTES: readonly Omit<SiteRoute, "locales">[] = [
	{ changeFrequency: "weekly", path: "/", priority: 1 },
];

interface IndexableContent extends PublicationData {
	readonly effectiveAt?: string;
	readonly noindex?: boolean;
	readonly publishedAt?: string;
	readonly updatedAt?: string;
}

interface IndexablePage {
	readonly data: IndexableContent;
	readonly slugs: readonly string[];
}

const getContentSlug = (page: IndexablePage): string =>
	page.data.variantOf ?? page.slugs.at(-1) ?? "";

const getLastModified = (page: IndexablePage): string | undefined =>
	page.data.updatedAt ?? page.data.publishedAt ?? page.data.effectiveAt;

interface CollectionOptions<TPage extends IndexablePage> {
	changeFrequency: ChangeFrequency;
	pages: readonly TPage[];
	prefix: string;
	priority: number;
	slug?: (page: TPage) => string;
}

function collectionRoutes<TPage extends IndexablePage>({
	changeFrequency,
	pages,
	prefix,
	priority,
	slug: resolveSlug = getContentSlug,
}: CollectionOptions<TPage>): SiteRoute[] {
	const visible = getVisibleContent<TPage["data"]>(pages);

	return visible.flatMap((page) => {
		if (page.data.noindex === true) {
			return [];
		}

		const slug = resolveSlug(page as TPage);
		if (!slug) {
			return [];
		}

		return {
			changeFrequency,
			lastModified: getLastModified(page),
			locales: EN_ONLY,
			path: `${prefix}/${slug}`,
			priority,
		};
	});
}

export const siteRoutes = cache(async (): Promise<SiteRoute[]> => {
  const { developersSource } = await import("@/lib/sources");

  const routes: SiteRoute[] = [
    ...STATIC_ROUTES.map(
      (route): SiteRoute => ({
        ...route,
        locales: localesForRoute(route.path),
      }),
    ),
    ...collectionRoutes({
      changeFrequency: "monthly",
      pages: developersSource.getPages(),
      prefix: "",
      priority: 0.6,
      slug: (page) => page.slugs.join("/"),
    }),
  ];

	const seen = new Set<string>();
	return routes.filter((route) => {
		if (seen.has(route.path)) {
			return false;
		}

		seen.add(route.path);
		return true;
	});
});

export async function siteUrls(locale: Locale = "en"): Promise<string[]> {
	const routes = await siteRoutes();
	return routes
		.filter((route) => route.locales.includes(locale))
		.map(
			(route) =>
				`${configuredUrls.website}${canonicalPath(route.path, locale)}`,
		);
}
