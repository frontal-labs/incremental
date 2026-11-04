// Plain object export: the config does not import vitest, so the fixture can be
// run from anywhere with the adapter's Vitest binary (CR-001).
export default {
  test: {
    include: ['packages/*/src/*.test.ts'],
    pool: 'forks'
  },
};
