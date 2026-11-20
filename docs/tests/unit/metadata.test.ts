import { beforeEach, describe, expect, it } from "vitest";

import msgEn from "@/locales/en.json";

const BASE = "https://incremental.dev";

const { pageMetadata } = await import("@/lib/metadata");
const { canonicalPath } = await import("@/lib/urls");

type PageMetadata = Awaited<ReturnType<typeof pageMetadata>>;

/** `alternates.languages` values, normalised to a plain record. */
const languagesOf = (meta: PageMetadata): Record<string, string> =>
  Object.fromEntries(
    Object.entries(meta.alternates?.languages ?? {}).flatMap(([code, value]) =>
      typeof value === "string" ? [[code, value] as const] : []
    )
  );

describe("canonicalPath", () => {
  it("prefixes the locale and adds a trailing slash", () => {
    expect(canonicalPath("/pricing", "en")).toBe("/en/pricing/");
    expect(canonicalPath("/pricing", "de")).toBe("/de/pricing/");
  });

  it("maps the home path to the locale root", () => {
    expect(canonicalPath("/", "en")).toBe("/en/");
  });

  it("is idempotent on an already-slashed path", () => {
    expect(canonicalPath("/pricing/", "en")).toBe("/en/pricing/");
  });
});

describe("pageMetadata", () => {
  let meta: ReturnType<typeof pageMetadata>;

  beforeEach(() => {
    meta = pageMetadata({
      description: "Plans and pricing.",
      locale: "en",
      path: "/pricing",
      title: "Pricing",
    });
  });

  it("emits a self-referencing canonical matching the served URL", () => {
    // `trailingSlash: true` means /en/pricing/ is the URL that returns 200; a
    // canonical without the slash would point at a redirect.
    //
    // Absolute rather than relative: three route subtrees are served on their
    // A relative canonical would not be explicit enough for crawlers.
    expect(meta.alternates?.canonical).toBe(`${BASE}/en/pricing/`);
  });

  it("points each hreflang at the same page in that locale", () => {
    // `locales` is passed explicitly so this asserts the path-mapping shape
    // rather than the route's current translation status — which is what
    // `i18n-hreflang.test.ts` covers, and which changes as copy is translated.
    const languages = languagesOf(
      pageMetadata({
        description: "Plans and pricing.",
        locale: "en",
        locales: ["en", "de", "ja"],
        path: "/pricing",
        title: "Pricing",
      })
    );

    // The bug this replaces pointed every locale at its home page, so
    // /en/pricing/ claimed the German equivalent was /de/.
    expect(languages.de).toBe(`${BASE}/de/pricing/`);
    expect(languages.ja).toBe(`${BASE}/ja/pricing/`);
    expect(Object.keys(languages)).toHaveLength(4);
  });

  it("advertises only English for a route that is not fully translated", () => {
    // Every chrome page still renders hardcoded English copy, so claiming nine
    // alternates would put nine byte-identical URLs in one hreflang cluster.
    const languages = languagesOf(meta);

    expect([...Object.keys(languages)].sort()).toEqual(["en", "x-default"]);
  });

  it("declares an x-default pointing at English", () => {
    expect(languagesOf(meta)["x-default"]).toBe(`${BASE}/en/pricing/`);
  });

  it("keeps openGraph.siteName, which page metadata would otherwise drop", () => {
    // Page-level openGraph replaces the layout's rather than merging with it.
    expect(meta.openGraph?.siteName).toBe("Incremental Docs");
  });

  it("adds the Incremental suffix to the document title", () => {
    expect(meta.title).toEqual({ absolute: "Pricing | Incremental Docs" });
  });

  it("indexes by default on a production deployment", () => {
    expect(meta.robots).toBeUndefined();
  });

  it("restricts hreflang to the locales a page actually has", () => {
    const article = pageMetadata({
      description: "An English-only article.",
      locale: "en",
      locales: ["en"],
      path: "/blog/example",
      title: "Example",
      type: "article",
    });

    expect(Object.keys(languagesOf(article)).sort()).toEqual([
      "en",
      "x-default",
    ]);
  });

  it("noindexes a fallback render while keeping its links crawlable", () => {
    const fallback = pageMetadata({
      description: "An English-only article.",
      indexable: false,
      locale: "de",
      locales: ["en"],
      path: "/blog/example",
      title: "Example",
    });

    expect(fallback.robots).toEqual({ follow: true, index: false });
    // Still self-canonical: a cross-language canonical is invalid, so noindex
    // is what keeps the duplicate out of the index.
    expect(fallback.alternates?.canonical).toBe(`${BASE}/de/blog/example/`);
  });

  it("carries article timestamps into openGraph", () => {
    const article = pageMetadata({
      authors: ["Frontal Team"],
      description: "An article.",
      locale: "en",
      modifiedTime: "2026-02-01",
      path: "/blog/example",
      publishedTime: "2026-01-01",
      title: "Example",
      type: "article",
    });

    expect(article.openGraph).toMatchObject({
      authors: ["Frontal Team"],
      modifiedTime: "2026-02-01",
      publishedTime: "2026-01-01",
      type: "article",
    });
  });
});

/**
 * Two indexable pages sharing a description is a duplicate-content signal, and
 * it is easy to introduce by copying a route file. `/partners` and
 * `/partners/solutions` shipped byte-identical `metaDescription`,
 * `ogDescription` *and* keywords for exactly that reason — neither describing
 * the page it sat on.
 *
 * Checked in English only: the catalogues are at key parity and every locale is
 * translated from these, so a collision here is a collision everywhere.
 */
describe("SEO copy is per-page", () => {
  const flatten = (
    tree: Record<string, unknown>,
    prefix = ""
  ): [string, string][] =>
    Object.entries(tree).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;

      if (typeof value === "string") {
        return [[path, value] as [string, string]];
      }

      return value && typeof value === "object"
        ? flatten(value as Record<string, unknown>, path)
        : [];
    });

  const entries = flatten(msgEn as unknown as Record<string, unknown>);

  it.each(["metaDescription", "ogDescription", "metaTitle"])(
    "uses a distinct %s on every page",
    (field) => {
      const byValue = new Map<string, string[]>();

      for (const [key, value] of entries.filter(([candidate]) =>
        candidate.endsWith(`.${field}`)
      )) {
        byValue.set(value, [...(byValue.get(value) ?? []), key]);
      }

      const shared = [...byValue.entries()]
        .filter(([, keys]) => keys.length > 1)
        .map(([, keys]) => keys.join(" == "));

      expect(shared).toEqual([]);
    }
  );
});
