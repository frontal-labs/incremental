"use client";

import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useControllableState } from "@/hooks/use-controllable-state";
import { cn } from "@/lib/utils";

type ThemeKey = "light" | "dark" | "system";

interface Theme {
  icon: LucideIcon;
  key: ThemeKey;
  label: string;
}

interface ThemeToggleProps {
  className?: string;
  defaultValue?: ThemeKey;
  onChange?: (theme: ThemeKey) => void;
  value?: ThemeKey;
}

const themes: Theme[] = [
  {
    key: "system",
    icon: Monitor,
    label: "System theme",
  },
  {
    key: "light",
    icon: Sun,
    label: "Light theme",
  },
  {
    key: "dark",
    icon: Moon,
    label: "Dark theme",
  },
];

const ThemeToggle = ({
  value,
  onChange,
  defaultValue = "system",
  className,
}: ThemeToggleProps) => {
  const [theme, setTheme] = useControllableState({
    defaultValue,
    value,
    onChange,
  });
  const [mounted, setMounted] = useState(false);

  const handleThemeClick = useCallback(
    (themeKey: ThemeKey) => {
      setTheme(themeKey);
    },
    [setTheme],
  );

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div
      className={cn(
        "relative isolate flex h-8 w-fit rounded-full bg-subtle p-1 ring-1 ring-border",
        className,
      )}
    >
      {themes.map(({ key, icon: Icon, label }: Theme) => {
        const isActive = theme === key;

        return (
          <button
            aria-label={label}
            className="relative h-6 w-6 cursor-pointer rounded-full"
            key={key}
            onClick={() => handleThemeClick(key as ThemeKey)}
            type="button"
          >
            {isActive && (
              <motion.div
                className="absolute inset-0 rounded-full bg-secondary"
                layoutId="activeTheme"
                transition={{ type: "spring", duration: 0.5 }}
              />
            )}
            <Icon
              className={cn(
                "relative z-10 m-auto h-4 w-4",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            />
          </button>
        );
      })}
    </div>
  );
};

export { ThemeToggle, type ThemeToggleProps };
