import { expect } from "@playwright/test";

import { test } from "../fixtures/test";
import { checkCriticalAccessibility } from "../helpers/accessibility";

test.describe("critical accessibility", () => {
  test("homepage has no critical violations", async ({ page }) => {
    await page.goto("/en/");
    const results = await checkCriticalAccessibility(page);

    expect(results.violations).toEqual([]);
  });

  test("contact form exposes its fields", async ({ page }) => {
    await page.goto("/en/contact/sales/");

    await expect(page.locator('input[name="fullName"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('textarea[name="message"]')).toBeVisible();
  });
});
