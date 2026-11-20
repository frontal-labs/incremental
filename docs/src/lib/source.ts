import { getVisibleContent } from "@/lib/content";
import { isLocale, type Locale } from "@/lib/locales";
import { developersSource } from "@/lib/sources";

const DEFAULT_LOCALE: Locale = "en";

const normalizeHref = (value: string): string =>
  value.split("#")[0]?.split("?")[0]?.replace(/\/+$/, "") ?? value;

export const toLocale = (value: string | undefined): Locale =>
  value && isLocale(value) ? value : DEFAULT_LOCALE;

export const source = {
  getPageByHref(
    href: string,
    { language }: { language?: string } = {}
  ) {
    const normalizedHref = normalizeHref(href);
    const pages = getVisibleContent(developersSource.getPages(), {
      locale: toLocale(language),
    });

   const page = pages.find((candidate) =>
      normalizeHref(
        candidate.slugs.length > 0
          ? `/${candidate.slugs.join("/")}`
          : "/",
      ) === normalizedHref
   );

    return { page };
  },
};
