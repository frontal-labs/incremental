import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ErrorView } from "@/components/error";
import { Theme } from "@/components/theme";
import { fonts } from "@/lib/fonts";
import { isLocale } from "@/lib/locales";

import "@/styles/globals.css";

export const Route = createRootRoute({
  head: () => ({
    links: [
      { href: "/favicon.ico", rel: "icon" },
      { href: "/manifest.webmanifest", rel: "manifest" },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { content: "dark light", name: "color-scheme" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  const { pathname } = useLocation();
  const locale = pathname.split("/")[1] ?? "";

  return (
    <RootDocument lang={isLocale(locale) ? locale : "en"}>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({
  children,
  lang,
}: Readonly<{ children: ReactNode; lang: string }>) {
  return (
    <html data-scroll-behavior="smooth" lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className={`bg-background font-sans antialiased ${fonts}`}>
        <Theme
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          {children}
        </Theme>
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <main className="w-full overflow-hidden md:overflow-visible">
      <div className="relative overflow-visible lg:overflow-hidden">
        <ErrorView
          action={{
            href: "/",
            label: "Go to home",
          }}
          description="The page you are looking for does not exist."
          title="Not found"
        />
      </div>
    </main>
  );
}
