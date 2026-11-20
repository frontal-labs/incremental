"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";

const HAPTIC_PATTERNS = {
  light: 10,
  medium: 20,
  heavy: 30,
  success: [10, 40, 10],
  warning: [20, 40, 20, 40, 20],
  error: [30, 60, 30, 60, 30],
  selection: 5,
} as const satisfies Record<string, number | readonly number[]>;

export type HapticPattern = keyof typeof HAPTIC_PATTERNS;

export interface UseHapticsResult {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  supported: boolean;
  trigger: (
    pattern?: HapticPattern,
    options?: Readonly<{ force?: boolean }>,
  ) => void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeSupported(): () => void {
  return () => {};
}

function getSupportedSnapshot(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function getServerSnapshot(): boolean {
  return false;
}

export function useHaptics(): UseHapticsResult {
  const supported = useSyncExternalStore(
    subscribeSupported,
    getSupportedSnapshot,
    getServerSnapshot,
  );
  // Subscribed once instead of re-querying matchMedia inside `trigger`,
  // which can run on every pointer move during a drag.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getServerSnapshot,
  );
  const [enabled, setEnabled] = useLocalStorage(
    "incremental:haptics-enabled",
    true,
  );

  const trigger = useCallback(
    (
      pattern: HapticPattern = "light",
      options?: Readonly<{ force?: boolean }>,
    ) => {
      if (!(supported && enabled)) {
        return;
      }
      if (reducedMotion && !options?.force) {
        return;
      }
      navigator.vibrate(HAPTIC_PATTERNS[pattern] as number | number[]);
    },
    [supported, enabled, reducedMotion],
  );

  return { trigger, supported, enabled, setEnabled };
}
