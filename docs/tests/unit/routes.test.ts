import { describe, expect, it } from "vitest";

import { STATIC_ROUTES } from "@/lib/routes";

describe("static route registry", () => {
  it("includes the localized home page", () => {
    expect(STATIC_ROUTES).toContainEqual({
      changeFrequency: "weekly",
      path: "/",
      priority: 1,
    });
  });

  it("has unique, slash-normalized paths", () => {
    const paths = STATIC_ROUTES.map((route) => route.path);

    expect(paths.length).toBe(new Set(paths).size);
    expect(paths.every((path) => path === "/" || !path.endsWith("/"))).toBe(
      true
    );
  });

  it("assigns a positive sitemap priority to every route", () => {
    expect(STATIC_ROUTES.every((route) => route.priority > 0)).toBe(true);
  });
});
