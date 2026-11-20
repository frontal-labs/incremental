"use client";

import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

/** Maps our `variant` vocabulary onto sonner's per-variant toast helpers. */
const TOAST_VARIANTS = {
  error: sonnerToast.error,
  info: sonnerToast.info,
  success: sonnerToast.success,
  warning: sonnerToast.warning,
} as const;

export interface ToastOptions {
  description?: ReactNode;
  duration?: number;
  title: ReactNode;
  variant?: "error" | "success" | "warning" | "info";
}

/**
 * The app's one way to raise a toast.
 *
 * Keeping it here means changing how a toast looks or behaves stays a single
 * edit.
 */
export function useToast() {
  return {
    toast: ({ description, duration, title, variant = "info" }: ToastOptions) =>
      TOAST_VARIANTS[variant](title, { description, duration }),
  };
}
