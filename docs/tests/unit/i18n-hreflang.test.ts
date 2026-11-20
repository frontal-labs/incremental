import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LOCALE_CODES } from "@/lib/locales";
import { pageMetadata } from "@/lib/metadata";
import {
  FULLY_TRANSLATED_ROUTES,
  localesForRoute,
  STATIC_ROUTES,
} from "@/lib/routes";

const ROUTES_DIR = path.resolve(import.meta.dirname, "../../src/routes");

/**
 * Guards the claim the sitemap and every page's hreflang make about which
 * locales a route is translated into.
 *
 * The bug this replaces: `STATIC_ROUTES` were all stamped `ALL_LOCALES` on the
 * premise that "chrome pages are translated through next-intl messages". Most
 * are not — 24 of 34 page components render English literals — so the sitemap
 * advertised nine alternates for nine URLs serving identical English, which is
 * a duplicate-content cluster rather than a set of translations.
 */

/**
 * The page component file backing a locale-less route path.
 *
 * TanStack Start keeps the locale layout and its index route under the routes
 * directory.
 */
const pageFilesFor = (route: string): string[] =>
  route === "/" ? [path.join(ROUTES_DIR, "$locale", "index.tsx")] : [];

const readPage = (route: string): string | null => {
  for (const file of pageFilesFor(route)) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      // Try the next location.
    }
  }

  return null;
};

const usesTranslatedMetadata = (source: string): boolean =>
  source.includes("translateMessage");

describe("hreflang honesty", () => {
  it("defaults a route to English only", () => {
    // The default has to be the conservative one. A route that nobody has
    // verified as translated must not advertise alternates it cannot back.
    expect(localesForRoute("/definitely-not-translated")).toEqual(["en"]);
  });

  it("only widens hreflang for routes on the allow-list", () => {
    for (const route of FULLY_TRANSLATED_ROUTES) {
      expect(localesForRoute(route)).toEqual(LOCALE_CODES);
    }
  });

  it.each([...FULLY_TRANSLATED_ROUTES])(
    "%s translates its metadata, as its allow-list entry claims",
    (route) => {
      // Membership means "body *and* metadata come from messages". Metadata is
      // the half that is mechanically checkable: a page hardcoding an English
      // title while claiming nine alternates is the exact original defect.
      const source = readPage(route);

      expect(source).not.toBeNull();
      expect(usesTranslatedMetadata(source ?? "")).toBe(true);
    }
  );

  it("advertises no alternates a route is not translated into", () => {
    const overclaiming = STATIC_ROUTES.filter((route) => {
      const languages = pageMetadata({
        description: "Example",
        locale: "en",
        path: route.path,
        title: "Example",
      }).alternates?.languages;

      const advertised = Object.keys(languages ?? {}).filter(
        (code) => code !== "x-default"
      );

      return advertised.length !== localesForRoute(route.path).length;
    });

    expect(overclaiming.map((route) => route.path)).toEqual([]);
  });

  it("noindexes a locale render the route has no content for", () => {
    // Untranslated locale renders stay crawlable but must not be indexed, so
    // they never compete with the English original as near-duplicates.
    const german = pageMetadata({
      description: "Plans and pricing.",
      locale: "de",
      path: "/pricing",
      title: "Pricing",
    });

    expect(german.robots).toMatchObject({ follow: true, index: false });
  });
});
