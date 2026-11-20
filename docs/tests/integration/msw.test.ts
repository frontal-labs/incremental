import { describe, expect, it } from "vitest";

describe("request mock infrastructure", () => {
  it("serves deterministic responses through MSW", async () => {
    const response = await fetch("http://localhost/api/health/");
    const body = (await response.json()) as { status: string };

    expect(response.ok).toBe(true);
    expect(body.status).toBe("ok");
  });
});
