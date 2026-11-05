import { existsSync } from "node:fs";

// Module resolution shadowing: the test looks for an optional shadow module.
// The file does not exist in the base state, so the test probes a missing path.
it("probes for an optional shadow module", () => {
  const shadowed = existsSync(new URL("../src/shadow.ts", import.meta.url));
  expect(typeof shadowed).toBe("boolean");
});
