// Enumerates the whole environment (V11).
it("enumerates the environment", () => {
  expect(Object.keys(process.env).length).toBeGreaterThan(0);
});
