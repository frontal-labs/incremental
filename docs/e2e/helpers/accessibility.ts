import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export async function checkCriticalAccessibility(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();

  return {
    ...results,
    allViolations: results.violations,
    violations: results.violations.filter(
      ({ impact }) => impact === "critical"
    ),
  };
}
