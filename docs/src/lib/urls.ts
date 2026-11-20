import { siteUrls } from "@/config/config";
import type { Locale } from "@/lib/locales";

/**
 * URL shape helpers, shared by the metadata layer, the sitemap, and the route
 * registry so the three can never disagree about what a page's URL is.
 *
 * Deliberately free of server-only imports — client components build the same
 * paths for client-side router links.
 */

/**
 * TanStack Start serves page routes with a trailing slash, so emitting the
 * slashed form keeps the declared canonical byte-identical to the URL that
 * actually returns 200.
 */
export const withTrailingSlash = (path: string): string =>
	path.endsWith("/") ? path : `${path}/`;

/**
 * The canonical, locale-prefixed path for a locale-less route.
 *
 * `localePrefix` is `"always"`, so every page lives under `/{locale}`; a path
 * without one redirects. `/` becomes `/{locale}/`.
 */
export const canonicalPath = (path: string, locale: Locale): string =>
	withTrailingSlash(path === "/" ? `/${locale}` : `/${locale}${path}`);

/**
 * The locale-prefixed path used by the browser and crawlers.
 */
export const publicCanonicalPath = (path: string, locale: Locale): string =>
	canonicalPath(path, locale);

/** Absolute canonical URL for a route on the single public origin. */
export const canonicalUrlForRoute = (path: string, locale: Locale): string =>
	`${siteUrls.website}${publicCanonicalPath(path, locale)}`;
