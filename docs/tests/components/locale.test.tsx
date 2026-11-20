import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n";
import { Locale } from "@/components/locale";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("@/components/navigation", () => ({
  usePathname: () => "/en/",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));

const renderLocale = () =>
  render(
    <I18nProvider locale="en">
      <Locale align="end" side="top" />
    </I18nProvider>
  );

describe("Locale", () => {
  beforeEach(() => {
    navigation.replace.mockReset();
  });

  it("opens the language menu from the footer trigger", async () => {
    const user = userEvent.setup();
    renderLocale();

    await user.click(
      screen.getByRole("combobox", { name: "Document language" })
    );

    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.getByRole("option", { name: "Português" })).toBeVisible();
  });

  it("navigates to the selected locale", async () => {
    const user = userEvent.setup();
    renderLocale();

    await user.click(
      screen.getByRole("combobox", { name: "Document language" })
    );
    await user.click(screen.getByRole("option", { name: "Português" }));

    expect(navigation.replace).toHaveBeenCalledWith("/en/", { locale: "pt" });
  });
});
