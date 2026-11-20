import { expect } from "@playwright/test";

import { test } from "../fixtures/test";

const PAGE_TITLE_PATTERN = /.+/;
const PRICING_LINK_PATTERN = /pricing/i;
const PRICING_URL_PATTERN = /\/en\/pricing\/$/;

test.describe("public site smoke tests", () => {
  test("loads the English homepage", async ({ page, locale }) => {
    const response = await page.goto(`/${locale}/`);

    expect(response?.ok()).toBe(true);
    await expect(page.locator("main")).toBeVisible();
    await expect(page).toHaveTitle(PAGE_TITLE_PATTERN);
  });

  test("navigates to pricing", async ({ page, locale }) => {
    await page.goto(`/${locale}/`);
    await page
      .getByRole("link", { name: PRICING_LINK_PATTERN })
      .first()
      .click();

    await expect(page).toHaveURL(PRICING_URL_PATTERN);
    await expect(page.locator("main")).toBeVisible();
  });
});
