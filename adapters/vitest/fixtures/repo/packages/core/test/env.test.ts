// Reads one environment variable (V10).
it('reads FIXTURE_MODE', () => {
  const mode = process.env.FIXTURE_MODE ?? 'default';
  expect(mode.length).toBeGreaterThan(0);
});
