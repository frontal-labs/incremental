import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*"],
    },
    compatibilityDate: "2026-11-18",
    domains: ["incremental.dev", "www.incremental.dev", "docs.incremental.dev"],
    entrypoint: "./worker/index.ts",
    env: {
      ASSETS: bindings.assets(),
      CRON_SECRET: bindings.secret(),
      IMAGES: bindings.images(),
    },
    name: "incremental-docs",
    triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
  }),
});
