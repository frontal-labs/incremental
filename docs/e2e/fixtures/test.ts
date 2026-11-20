import { test as base } from "@playwright/test";

interface TestFixtures {
  locale: string;
  /**
   * Serve CDN media as stubs instead of fetching it. On by default, because
   * most specs assert on text and attributes and should not wait on megabytes
   * of hero video. Specs that assert the media itself renders — that an image
   * decodes, that a video plays — must opt out with
   * `test.use({ stubMedia: false })`, or they would be verifying the stub.
   */
  stubMedia: boolean;
}

/** A 1x1 transparent PNG, standing in for whatever image was requested. */
const STUB_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

/** Every asset origin the pages pull media from. */
const CDN_ASSETS = "https://cdn.incremental.dev/**";

export const test = base.extend<TestFixtures>({
  locale: "en",
  page: async ({ page, stubMedia }, use) => {
    await page.route("**/ingest/**", (route) =>
      route.fulfill({
        body: "{}",
        contentType: "application/json",
        status: 200,
      })
    );

    // `page.goto` resolves on `load`, so each navigation waits for the hero
    // video and imagery these pages fetch from the CDN — several megabytes per
    // page, over the public network, to satisfy assertions that only read text
    // and attributes. Serving a stub keeps the elements in the document and
    // their layout intact without the transfer, which is what made this suite
    // time out on whichever locale happened to be slowest.
    if (stubMedia) {
      await page.route(CDN_ASSETS, (route) => {
        const isMedia = route.request().resourceType() === "media";

        return route.fulfill({
          body: isMedia ? "" : STUB_IMAGE,
          contentType: isMedia ? "video/mp4" : "image/png",
          status: 200,
        });
      });
    }

    await use(page);
  },
  stubMedia: true,
});
