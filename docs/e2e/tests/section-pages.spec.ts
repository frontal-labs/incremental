import { expect } from "@playwright/test";

import { test } from "../fixtures/test";

// This spec asserts that the CDN media itself renders — that an image decodes
// and a video plays — so it has to fetch the real files rather than the stubs
// the fixture serves everywhere else.
test.use({ stubMedia: false });

/**
 * `type: "none"` is a surface that lists entries as text alone. The newsroom is
 * one: its rows carry a title, category and date and no cover art, so asserting
 * on media there would be asserting a design it does not have.
 */
const pages = [
  { heading: "Newsroom", path: "/en/news", type: "none" },
  { heading: "Blog", path: "/en/blog", type: "video" },
  { heading: "Releases", path: "/en/releases", type: "image" },
] as const;

for (const { heading, path, type } of pages) {
  test(`${heading} renders its section content`, async ({ page }, testInfo) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    const response = await page.goto(path);

    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("main a")).not.toHaveCount(0);

    if (type === "none") {
      await expect(page.locator("main img, main video")).toHaveCount(0);
    }

    const media = page.locator(`main ${type === "image" ? "img" : "video"}`);

    if (type !== "none") {
      await expect(media).not.toHaveCount(0);
    }

    if (type === "image") {
      await Promise.all(
        (await media.all()).map(async (item) => {
          await item.scrollIntoViewIfNeeded();
          await expect
            .poll(
              () =>
                item.evaluate((element) =>
                  element instanceof HTMLImageElement ? element.naturalWidth : 0
                ),
              // A cold Cloudflare transform of a large source can take several
              // seconds before the first byte reaches the browser.
              { timeout: 20_000 }
            )
            .toBeGreaterThan(0);
        })
      );
    } else if (type === "video") {
      expect(
        await media.evaluateAll((elements) =>
          elements.every(
            (element) =>
              element instanceof HTMLVideoElement &&
              element.autoplay &&
              element.loop &&
              element.muted
          )
        )
      ).toBe(true);

      const leadVideo = media.first();
      await leadVideo.scrollIntoViewIfNeeded();
      await expect
        .poll(
          () =>
            leadVideo.evaluate(
              (element) =>
                element instanceof HTMLVideoElement && !element.paused
            ),
          { timeout: 20_000 }
        )
        .toBe(true);
    }

    expect(pageErrors).toHaveLength(0);
    await page.screenshot({
      fullPage: true,
      path: `/tmp/${testInfo.project.name}-${heading.toLowerCase()}.png`,
    });
  });
}
