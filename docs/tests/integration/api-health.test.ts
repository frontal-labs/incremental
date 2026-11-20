import { describe, expect, it } from "vitest";

import { GET } from "@/routes/api/health";

describe("GET /api/health", () => {
  it("returns a timestamped healthy response", async () => {
    const response = await GET();
    const body = (await response.json()) as {
      status: string;
      timestamp: string;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
