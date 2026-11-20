import { cn } from "@/lib/utils";

/** The theme carried by a page section. */
export type SectionTheme = "brand" | "dark" | "default" | "subtle";

export interface SectionThemeProps {
  className?: string;
  "data-theme"?: SectionTheme;
}

/** Return the classes and semantic marker for a themed section. */
export function sectionProps(
  theme: SectionTheme = "default",
  className?: string
): SectionThemeProps {
  if (theme === "default") {
    return { className };
  }

  if (theme === "subtle") {
    return {
      className: cn(className, "bg-subtle text-subtle-foreground"),
      "data-theme": theme,
    };
  }

  return {
    className: cn("dark text-foreground", className),
    "data-theme": theme,
  };
}
