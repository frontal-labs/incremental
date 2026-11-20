import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "feed";

import { siteConfig, siteUrls } from "@/config/config";
import { api } from "@/lib/api";
import { getVisibleContent } from "@/lib/content";
import type { Locale } from "@/lib/locales";
import { developersSource } from "@/lib/sources";
import { canonicalPath } from "@/lib/urls";

const DEFAULT_LOCALE: Locale = "en";
const FEED_TITLE = "Incremental Developer Documentation";
const FEED_DESCRIPTION = "Developer documentation for Incremental.";
const origin = siteUrls.website;

interface FeedPageData {
  readonly description?: string;
  readonly noindex?: boolean;
  readonly publishedAt?: string;
  readonly title?: string;
  readonly updatedAt?: string;
  readonly variantOf?: string;
}

interface FeedPage {
  readonly data: FeedPageData;
  readonly slugs: readonly string[];
}

const collect = <TPage extends FeedPage>(
  pages: readonly TPage[],
  prefix: string
) =>
  getVisibleContent<TPage["data"]>(pages, { locale: DEFAULT_LOCALE }).flatMap(
    (page) => {
      const slug = page.data.variantOf ?? page.slugs.at(-1);
      if (!(slug && page.data.title) || page.data.noindex === true) {
        return [];
      }

      const published = page.data.updatedAt ?? page.data.publishedAt;
      return {
        date: published ? new Date(published) : new Date(0),
        description: page.data.description ?? "",
        title: page.data.title,
        url:
          origin +
          canonicalPath(
            prefix ? `${prefix}/${slug}` : `/${slug}`,
            DEFAULT_LOCALE
          ),
      };
    }
  );

export const GET = (): Response => {
  const feed = new Feed({
    copyright: `All rights reserved ${new Date().getFullYear()}, ${
      siteConfig.publisher
    }`,
    description: FEED_DESCRIPTION,
    id: `${origin}/rss.xml`,
    language: DEFAULT_LOCALE,
    link: origin + canonicalPath("/", DEFAULT_LOCALE),
    title: FEED_TITLE,
  });
  const entries = [...collect(developersSource.getPages(), "")].sort(
    (left, right) => right.date.getTime() - left.date.getTime()
  );

  for (const entry of entries) {
    feed.addItem({
      date: entry.date,
      description: entry.description,
      id: entry.url,
      link: entry.url,
      title: entry.title,
    });
  }

  return new Response(feed.rss2(), {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
};

export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: { GET: ({ request }) => api(request, GET) },
  },
});
