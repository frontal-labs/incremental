import type { Locale } from "@/lib/locales";

export type ContentRegion =
  | "global"
  | "europe"
  | "north-america"
  | "latin-america"
  | "asia-pacific"
  | "middle-east-africa";

export interface PublicationData {
  readonly audience?: string;
  readonly authors?: readonly string[];
  readonly availability?: string;
  readonly body?: unknown;
  readonly category?: string;
  readonly company?: string;
  readonly department?: string;
  readonly description?: string;
  readonly fallbackLocale?: Locale;
  readonly featured?: boolean;
  readonly image?: string;
  readonly imageAlt?: string;
  readonly industry?: string;
  readonly keywords?: readonly string[];
  readonly kind?: string;
  readonly locale?: Locale;
  readonly location?: string;
  readonly noindex?: boolean;
  readonly publishAt?: string | Date;
  readonly published?: boolean;
  readonly publishedAt?: string | Date;
  readonly publishRegions?: readonly ContentRegion[];
  readonly readingTime?: number;
  readonly release?: string;
  readonly reviewedAt?: string | Date;
  readonly showCover?: boolean;
  readonly tags?: readonly string[];
  readonly takeaways?: readonly string[];
  readonly title?: string;
  readonly toc?: readonly unknown[];
  readonly unpublishAt?: string | Date;
  readonly updatedAt?: string | Date;
  readonly variantOf?: string;
  readonly version?: string;
  readonly video?: string;
  readonly videoAlt?: string;
}

export interface ContentPage<TData = PublicationData> {
  readonly data: TData;
  readonly slugs: readonly string[];
}

export interface ContentVisibilityOptions<TData = PublicationData> {
  readonly key?: (page: ContentPage<TData>) => string;
  readonly locale?: Locale;
  readonly now?: Date;
}

const DEFAULT_LOCALE: Locale = "en";
const DEFAULT_REGIONS: readonly ContentRegion[] = ["global"];

const localeRegions: Readonly<Record<Locale, ContentRegion>> = {
  de: "europe",
  en: "north-america",
  es: "europe",
  fr: "europe",
  it: "europe",
  ja: "asia-pacific",
  ko: "asia-pacific",
  pt: "europe",
  zh: "asia-pacific",
};

function toTimestamp(value: string | Date | undefined): number | undefined {
  if (!value) {
    return;
  }

  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function getContentRegion(locale: Locale): ContentRegion {
  return localeRegions[locale];
}

export function isContentVisible<TData extends PublicationData>(
  data: TData,
  { locale = DEFAULT_LOCALE, now = new Date() }: ContentVisibilityOptions = {}
): boolean {
  if (data.published === false) {
    return false;
  }

  if (process.env.NODE_ENV !== "development") {
    const nowTimestamp = now.getTime();
    // `publishAt` is the explicit go-live moment, but most collections only
    // carry `publishedAt`, the date the piece is stamped with. A piece dated in
    // the future is not published yet, so treat it as the go-live moment when
    // no `publishAt` was authored. Without this fallback, forgetting one field
    // silently ships an embargoed announcement.
    const publishTimestamp = toTimestamp(data.publishAt ?? data.publishedAt);
    const unpublishTimestamp = toTimestamp(data.unpublishAt);

    if (publishTimestamp !== undefined && publishTimestamp > nowTimestamp) {
      return false;
    }

    if (
      unpublishTimestamp !== undefined &&
      unpublishTimestamp <= nowTimestamp
    ) {
      return false;
    }
  }

  const regions = data.publishRegions ?? DEFAULT_REGIONS;
  return (
    regions.includes("global") || regions.includes(getContentRegion(locale))
  );
}

function getContentKey<TData extends PublicationData>(
  page: ContentPage<TData>,
  customKey?: (page: ContentPage<TData>) => string
): string {
  if (customKey) {
    return customKey(page);
  }
  return page.data.variantOf ?? page.slugs.join("/");
}

function getLocaleRank(
  pageLocale: Locale | undefined,
  requestedLocale: Locale,
  fallbackLocale: Locale
): number {
  if (pageLocale === requestedLocale) {
    return 2;
  }
  if (pageLocale === fallbackLocale) {
    return 1;
  }
  return 0;
}

/** Return one visible page per content key, preferring the requested locale. */
export function getVisibleContent<TData extends PublicationData>(
  pages: readonly ContentPage<TData>[],
  options: ContentVisibilityOptions = {}
): ContentPage<TData>[] {
  const requestedLocale = options.locale ?? DEFAULT_LOCALE;
  const customKey = options.key;
  const selectedPages = new Map<string, ContentPage<TData>>();

  for (const page of pages) {
    if (!isContentVisible(page.data, options)) {
      continue;
    }

    const key = getContentKey(page, customKey);
    const currentPage = selectedPages.get(key);
    const pageFallback = page.data.fallbackLocale ?? DEFAULT_LOCALE;
    const pageRank = getLocaleRank(
      page.data.locale,
      requestedLocale,
      pageFallback
    );

    if (!currentPage) {
      selectedPages.set(key, page);
      continue;
    }

    const currentFallback = currentPage.data.fallbackLocale ?? DEFAULT_LOCALE;
    const currentRank = getLocaleRank(
      currentPage.data.locale,
      requestedLocale,
      currentFallback
    );

    if (pageRank > currentRank) {
      selectedPages.set(key, page);
    }
  }

  return [...selectedPages.values()];
}
