import { LEAF } from "../src/leaf.ts";

it("leaf a reads the leaf utility", () => {
  expect(typeof LEAF).toBe("number");
});
