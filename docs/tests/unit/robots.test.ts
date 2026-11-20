import { describe, expect, it } from "vitest";

const { GET } = await import("@/routes/robots[.]txt");

/** The single `*` group the route emits. */
const rulesOf = async () => {
  const body = await (await GET()).text();
  const entries = body
    .split("\n")
    .map((line) => line.split(": ", 2))
    .filter(([key]) => key === "Allow" || key === "Disallow");

  return {
    allow: entries.filter(([key]) => key === "Allow").map(([, value]) => value),
    disallow: entries
      .filter(([key]) => key === "Disallow")
      .map(([, value]) => value),
  };
};

describe("robots.txt", () => {
  it("keeps the social card image fetchable", async () => {
    const { allow, disallow } = await rulesOf();

    // Social crawlers obey robots.txt when fetching og:image, so the blanket
    // /api/ rule must not swallow the one API route every page links to.
    expect(allow).toContain("/api/og");
    expect(disallow).toContain("/api/");
  });

  it("still keeps the rest of the site's machinery out of the index", async () => {
    const { allow, disallow } = await rulesOf();

    expect(allow).toContain("/");
    expect(disallow).toContain("/*/search");
  });
});
