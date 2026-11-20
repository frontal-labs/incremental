import { describe, expect, it } from "vitest";

import { llmsTxt } from "@/lib/llms";

const CANONICAL_POSITIONING =
  "Incremental is a high-performance incremental computation engine that records what each task reads, lists, probes, and writes, then determines which tasks are invalid given changes since the last known-good baseline.";

describe("LLM-readable feeds", () => {
  it("uses the engine positioning", () => {
    const content = llmsTxt();

    expect(content).toContain(CANONICAL_POSITIONING);
    expect(content).not.toContain(
      "Incremental is the operating system for intelligent systems."
    );
  });
});
