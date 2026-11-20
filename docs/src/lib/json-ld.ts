import type { BreadcrumbList, WithContext } from "schema-dts";
import type { Locale } from "@/lib/locales";
import { canonicalUrlForRoute } from "@/lib/urls";

export interface Crumb {
  name: string;
  path: string;
}

/** Build breadcrumb JSON-LD for a page's visible hierarchy. */
export const breadcrumbJsonLd = (
  crumbs: readonly Crumb[],
  locale: Locale
): WithContext<BreadcrumbList> => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((crumb, index) => ({
    "@type": "ListItem" as const,
    item: canonicalUrlForRoute(crumb.path, locale),
    name: crumb.name,
    position: index + 1,
  })),
});
