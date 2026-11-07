import { ONLY_APP } from "../src/only-app.ts";

it("app-only test", () => {
  expect(typeof ONLY_APP).toBe("string");
});
