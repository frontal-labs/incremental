"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";
import { COOKIES } from "@/config/cookies";

interface ThemeProps
  extends React.ComponentProps<typeof NextThemesProvider> {
  nonce?: string;
}

export const Theme = ({
  children,
  nonce,
  ...props
}: ThemeProps) => (
  <NextThemesProvider
    attribute="class"
    defaultTheme="system"
    disableTransitionOnChange
    enableSystem
    nonce={nonce}
    storageKey={COOKIES.theme}
    {...props}
  >
    {children}
  </NextThemesProvider>
);
