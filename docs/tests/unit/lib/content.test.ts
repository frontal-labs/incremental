import { describe, expect, it } from "vitest";

import {
  type ContentPage,
  getVisibleContent,
  isContentVisible,
} from "@/lib/content";

const NOW = new Date("2026-09-02T12:00:00Z");

const page = (
  slug: string,
  data: ContentPage["data"]
): ContentPage<ContentPage["data"]> => ({ data, slugs: [slug] });

describe("isContentVisible", () => {
  it("hides a piece whose publication date has not arrived", () => {
    expect(isContentVisible({ publishedAt: "2026-09-22" }, { now: NOW })).toBe(
      false
    );
  });

  it("shows a piece whose publication date has passed", () => {
    expect(isContentVisible({ publishedAt: "2026-09-01" }, { now: NOW })).toBe(
      true
    );
  });

  it("lets an explicit publishAt embargo a back-dated piece", () => {
    expect(
      isContentVisible(
        { publishAt: "2026-09-23T09:00:00Z", publishedAt: "2026-09-01" },
        { now: NOW }
      )
    ).toBe(false);
  });

  it("lets an explicit publishAt release a forward-dated piece", () => {
    expect(
      isContentVisible(
        { publishAt: "2026-08-20T09:00:00Z", publishedAt: "2026-09-22" },
        { now: NOW }
      )
    ).toBe(true);
  });

  it("still honours published: false and unpublishAt", () => {
    expect(
      isContentVisible(
        { published: false, publishedAt: "2026-09-01" },
        { now: NOW }
      )
    ).toBe(false);
    expect(
      isContentVisible(
        { publishedAt: "2026-08-01", unpublishAt: "2026-09-01" },
        { now: NOW }
      )
    ).toBe(false);
  });

  it("shows undated content such as docs pages", () => {
    expect(isContentVisible({ title: "Overview" }, { now: NOW })).toBe(true);
  });
});

describe("getVisibleContent", () => {
  it("drops the pieces that are still embargoed", () => {
    const pages = [
      page("introducing-frontal", { publishedAt: "2026-09-01" }),
      page("frontal-is-now-available", { publishedAt: "2026-09-04" }),
    ];

    expect(
      getVisibleContent(pages, { now: NOW }).map((visible) => visible.slugs[0])
    ).toEqual(["introducing-frontal"]);
  });
});
