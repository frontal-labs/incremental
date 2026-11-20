/**
 * Next.js resolves `server-only` through its own compiled aliases, so the
 * package is not present in `node_modules` and Vite cannot resolve it. Unit
 * tests run server modules directly, where the guard is a no-op.
 */
export {};
