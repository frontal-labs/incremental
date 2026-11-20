import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import type { LockFile } from "../scripts/sync-registry";
import lock from "../ui.lock.json";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Heavy components (calendar pulls react-day-picker) exceed the 5s default on
// a cold transform cache.
const IMPORT_TIMEOUT_MS = 30_000;
const files = Object.values((lock as LockFile).items).flatMap(
  (item) => item.files
);

/**
 * Every file the registry sync owns must load as a module with at least one
 * export. This catches rewritten imports that point at nothing and registry
 * items whose external dependencies are not installed.
 */
describe("managed modules", () => {
  for (const file of files) {
    test(
      file.path,
      async () => {
        const mod = (await import(path.join(ROOT, file.path))) as Record<
          string,
          unknown
        >;
        expect(Object.keys(mod).length).toBeGreaterThan(0);
      },
      IMPORT_TIMEOUT_MS
    );
  }
});
