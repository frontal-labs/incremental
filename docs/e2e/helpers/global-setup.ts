import type { FullConfig } from "@playwright/test";

export default function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;

  if (!baseURL) {
    throw new Error("Playwright requires a configured baseURL.");
  }
}
