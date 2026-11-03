// Plain object export: the config does not import vitest, so the fixture can be
// copied anywhere and still run with the adapter's vitest binary (CR-001).
export default {
  test: {
    pool: 'forks',
    globals: true,
    include: ['packages/*/test/**/*.test.ts'],
  },
};
