import { expect } from "@playwright/test";

import { test } from "../fixtures/test";

test.describe("public API boundaries", () => {
  test("reports application health", async ({ request }) => {
    const response = await request.get("/api/health/");
    const body = await response.json();

    expect(response.ok()).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeTruthy();
  });

  test("returns an empty result set for an empty search", async ({
    request,
  }) => {
    const response = await request.get("/api/search/?q=");
    const body = await response.json();

    expect(response.ok()).toBe(true);
    expect(body.results).toEqual([]);
  });

  test("rejects oversized search queries", async ({ request }) => {
    const response = await request.get(`/api/search/?q=${"a".repeat(121)}`);

    expect(response.status()).toBe(400);
  });
});
