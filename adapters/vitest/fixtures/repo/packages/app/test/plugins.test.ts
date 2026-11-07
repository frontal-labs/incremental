import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = fileURLToPath(new URL("../plugins/", import.meta.url));

// Lists the plugin directory (V09) and dynamically imports one plugin (V05).
it("lists plugins and loads p1", async () => {
  expect(readdirSync(pluginDir).length).toBeGreaterThan(0);
  const mod = await import(path.join(pluginDir, "p1.ts"));
  expect(typeof mod.default()).toBe("string");
});
