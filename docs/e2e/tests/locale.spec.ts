import { expect } from "@playwright/test";

import { LOCALE_CODES } from "../../src/lib/locales";
import msgDe from "../../src/locales/de.json" with { type: "json" };
import msgEn from "../../src/locales/en.json" with { type: "json" };
import msgEs from "../../src/locales/es.json" with { type: "json" };
import msgFr from "../../src/locales/fr.json" with { type: "json" };
import msgIt from "../../src/locales/it.json" with { type: "json" };
import msgJa from "../../src/locales/ja.json" with { type: "json" };
import msgKo from "../../src/locales/ko.json" with { type: "json" };
import msgPt from "../../src/locales/pt.json" with { type: "json" };
import msgZh from "../../src/locales/zh.json" with { type: "json" };
import { test } from "../fixtures/test";

/**
 * A 200 and a visible `<main>` say nothing about *which language* rendered —
 * this suite previously passed while `/zh/` served Portuguese navigation.
 * Each locale is checked against a string only its own catalogue contains.
 */
/** `localePrefix: "always"`, so every served page sits under a locale. */
const LOCALE_PREFIXED_PATH = /^\/[a-z]{2}\//;

const CATALOGUES = {
  de: msgDe,
  en: msgEn,
  es: msgEs,
  fr: msgFr,
  it: msgIt,
  ja: msgJa,
  ko: msgKo,
  pt: msgPt,
  zh: msgZh,
};

test.describe("locale routing", () => {
  for (const locale of LOCALE_CODES) {
    test(`renders the ${locale} homepage in ${locale}`, async ({ page }) => {
      const response = await page.goto(`/${locale}/`);

      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();

      // The document must declare the locale it was requested in.
      await expect(page.locator("html")).toHaveAttribute("lang", locale);

      // "Sign in" appears in the header on every locale and is distinct in
      // each catalogue, so it doubles as a language fingerprint.
      //
      // `toContainText` rather than `toBeVisible`: at mobile widths the header
      // collapses the action into a closed menu, and this is asserting which
      // language rendered, not where the button sits.
      const { Header } = CATALOGUES[locale];
      await expect(page.locator("body")).toContainText(Header.signIn);
    });
  }

  test("redirects an unprefixed path into a locale", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toMatch(LOCALE_PREFIXED_PATH);
  });

  test("serves a translated 404 for a missing document", async ({ page }) => {
    // A `notFound()` thrown by a page under `[locale]` used to render English
    // copy under `<html lang="en">` whatever prefix the visitor was on, because
    // `not-found.tsx` reached for the locale through a client hook that has no
    // request context on this path. It now uses `getLocale()`.
    //
    // Note the boundary: `experimental.globalNotFound` means a URL matching no
    // route at all (e.g. `/de/nonsense/`) still renders the global English
    // document. This covers the ~95 pages that call `notFound()` themselves.
    const response = await page.goto("/de/legal/no-such-document/");

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("body")).toContainText(
      msgDe.Error.notFound.title
    );
  });
});
