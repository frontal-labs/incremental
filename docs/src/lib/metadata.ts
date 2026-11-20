import { siteConfig, siteUrls } from "@/config/config";
import type { Locale } from "@/lib/locales";
import { localesForRoute } from "@/lib/routes";
import { publicCanonicalPath } from "@/lib/urls";

type OpenGraphLocale =
	| "de_DE"
	| "en_US"
	| "es_ES"
	| "fr_FR"
	| "it_IT"
	| "ja_JP"
	| "ko_KR"
  | "pt_PT"
  | "zh_CN";

export interface Metadata {
  alternates?: {
    canonical: string;
    languages: Record<string, string>;
  };
  description: string;
  keywords?: string[];
  metadataBase: URL;
  openGraph?: {
    description: string;
    images: Array<{ alt: string; height: number; url: string; width: number }>;
    locale: OpenGraphLocale;
    siteName: string;
    title: string;
    type: "website" | "article";
    url: string;
    authors?: string[];
    modifiedTime?: string;
    publishedTime?: string;
  };
  robots?: { follow: boolean; index: boolean };
  title: { absolute: string };
  twitter: {
    card: "summary_large_image";
    creator: string;
    description: string;
    images: Array<{ alt: string; height: number; url: string; width: number }>;
    site: string;
    title: string;
  };
}

const OPEN_GRAPH_LOCALES: Record<Locale, OpenGraphLocale> = {
	de: "de_DE",
	en: "en_US",
	es: "es_ES",
	fr: "fr_FR",
	it: "it_IT",
	ja: "ja_JP",
	ko: "ko_KR",
	pt: "pt_PT",
	zh: "zh_CN",
};

const ogLocale = (locale: Locale): OpenGraphLocale =>
	OPEN_GRAPH_LOCALES[locale];

interface PageMetadataOptions {
	authors?: string[];
	canonical?: boolean;
	description: string;
	/** Absolute URL of a pre-rendered social image, overriding `/api/og`. */
	image?: string;
	imageAlt?: string;
	/**
	 * Set false when this render is a fallback rather than a real translation —
	 * an English MDX article served under `/de/...`, say. Emits `noindex, follow`
	 * so the page is crawlable and its links are followed, but never indexed as a
	 * near-duplicate of the English original.
	 */
	indexable?: boolean;
	keywords?: string[];
	locale?: Locale;
	/**
	 * Locales this page genuinely exists in. Defaults to whatever the shared
	 * route registry says this path is translated into (`localesForRoute`),
	 * which is `["en"]` unless the route has been verified fully translated.
	 * MDX-backed pages pass `["en"]` explicitly since they aren't in the
	 * static registry at all.
	 */
	locales?: readonly Locale[];
	modifiedTime?: string;
	og?: {
		title: string;
		description: string;
	};
	path: string;
	publishedTime?: string;
	title: string;
	type?: "website" | "article";
}

/**
 * Builds a page's metadata: canonical, hreflang, Open Graph, Twitter, robots.
 *
 * The canonical and the `languages` map are both derived from
 * `publicCanonicalPath`, so the declared URL always matches the one that
 * actually serves a 200 under `trailingSlash: true`.
 *
 * Every URL here is absolute and uses the one public origin. Reading request
 * headers here would make static routes dynamic, so the origin comes from the
 * deployment configuration instead.
 */
export function pageMetadata(opts: PageMetadataOptions): Metadata {
	const locale: Locale = opts.locale ?? "en";
	// Some localized titles already include the brand (for example the home
	// page title). Avoid emitting "Incremental ... | Incremental", which wastes title
	// pixels and pushes the meaningful query terms out of search snippets.
	const pageTitle = opts.title.includes(siteConfig.name)
		? opts.title
		: `${opts.title} | ${siteConfig.name}`;
	const origin = siteUrls.website;
	const absoluteFor = (code: Locale) =>
		`${origin}${publicCanonicalPath(opts.path, code)}`;

	const url = absoluteFor(locale);
	const ogTitle = opts.og?.title ?? opts.title;
	const ogDesc = opts.og?.description ?? opts.description;

	// Keep the social image on the same origin as `og:url`.
	const imageUrl = opts.image ?? `${origin}/api/og`;
	const images = [
		{
			alt: opts.imageAlt ?? ogTitle,
			height: 630,
			url: imageUrl,
			width: 1200,
		},
	];

	// hreflang must point at the *same page* in each locale, not the locale root.
	//
	// The default comes from the shared route registry rather than "all nine",
	// so a page's hreflang and its sitemap entry can never disagree about which
	// locales it is actually translated into. Callers may still narrow further
	// (MDX routes pass `["en"]` explicitly), but they cannot silently widen.
	const available = opts.locales ?? localesForRoute(opts.path);
	const languages = {
		...Object.fromEntries(available.map((code) => [code, absoluteFor(code)])),
		// Tells search engines which version to serve when no locale matches.
		"x-default": absoluteFor("en"),
	};

	// A render in a locale this page has no content for is a fallback, not a
	// translation: keep it crawlable but out of the index, so it never competes
	// with the English original as a near-duplicate.
	const isFallbackRender = !available.includes(locale);
	const noindex = opts.indexable === false || isFallbackRender;

	return {
		alternates:
			opts.canonical === false
				? undefined
				: {
						canonical: url,
						languages,
					},
		description: opts.description,
		// The deployment origin makes relative metadata resolve consistently.
		metadataBase: new URL(origin),
		title: { absolute: pageTitle },
		...(opts.keywords && { keywords: opts.keywords }),
		openGraph: {
			description: ogDesc,
			images,
			locale: ogLocale(locale),
			// Page-level `openGraph` replaces the layout's wholesale rather than
			// merging, so siteName has to be repeated here or every non-home page
			// loses it.
			siteName: siteConfig.name,
			title: ogTitle,
			type: opts.type ?? "website",
			url,
			...(opts.type === "article" && {
				authors: opts.authors,
				modifiedTime: opts.modifiedTime,
				publishedTime: opts.publishedTime,
			}),
		},
		...(noindex && {
			robots: { follow: true, index: false },
		}),
		twitter: {
			card: "summary_large_image",
			creator: siteConfig.twitterCreator,
			description: ogDesc,
			images,
			site: siteConfig.twitterSite,
			title: ogTitle,
		},
	};
}
