"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { useTheme } from "next-themes";
import { Locale } from "@/components/locale";
import { useTranslations } from "@/components/i18n";

export function Footnote() {
  const footer = useTranslations("Footer");

  // `ThemeToggle` is presentational - it tracks its own selection and never
  // touches next-themes, so it has to be driven as a controlled component.
  const { theme, setTheme } = useTheme();

  return (
    // The row's own top margin is gone: every caller already wraps this in a
    // padded band, so the two stacked and left the footnote sitting low in it.
    <div className="flex flex-col gap-3 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <ThemeToggle
          className="h-7 bg-transparent p-0.5"
          onChange={setTheme}
          value={theme as "light" | "dark" | "system" | undefined}
        />
        <Locale
          align="end"
          className="bg-transparent data-[size=sm]:rounded-full dark:bg-transparent dark:hover:bg-transparent"
          side="top"
          size="sm"
        />
      </div>
      {/* Reordered at `sm`, the same breakpoint the row turns horizontal at.
          Held back to `md`, the copyright kept a stacked layout's top margin
          and stayed after the controls for one breakpoint, so between the two
          it sat below the centre line and on the wrong side of the row. */}
      <p className="sm:order-first">
        {/*
          Passed as a string: a bare `{year}` placeholder given a number
          goes through ICU number formatting with grouping, rendering
          "© 2,026" in `en` and "© 2.026" in de/es/it/pt. A year is an
          identifier here, not a quantity.
        */}
        {footer("copyright", { year: String(new Date().getFullYear()) })}
      </p>
    </div>
  );
}
