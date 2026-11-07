// Reads a core file only through the workspace symlink (V07).
import { LINKED } from "@fixture/core/src/linked.ts";

it("linked file through the workspace symlink", () => {
  expect(typeof LINKED).toBe("string");
});
