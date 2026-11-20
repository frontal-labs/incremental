import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Crumb } from "@/components/crumb";
import { useTranslations } from "@/components/i18n";
import { JsonLd } from "@/components/json-ld";
import { Panel } from "@/components/panel";
import { Toc } from "@/components/toc";
import { devGroup, devNeighbors, devPage } from "@/lib/developers";
import { breadcrumbJsonLd } from "@/lib/json-ld";
import { isLocale, type Locale } from "@/lib/locales";
import { toc } from "@/lib/toc";
import { canonicalUrlForRoute } from "@/lib/urls";
import { formatDate } from "@/lib/utils";

export const Route = createFileRoute("/$locale/$")({
  beforeLoad: ({ params }) => {
    if (!isLocale(params.locale)) {
      throw notFound();
    }
  },
  component: DocumentPage,
});

function DocumentPage() {
  const { _splat, locale: requestedLocale } = Route.useParams();
  const locale = requestedLocale as Locale;
  const slugs = (_splat ?? "").split("/").filter(Boolean);
  const page = devPage(slugs, locale);

  if (!page) {
    throw notFound();
  }

  const { data } = page;
  const t = useTranslations("Developers");
  const shared = useTranslations("Docs");
  const Mdx = data.body;
  const pageToc = toc(page, { maxDepth: 2 });
  const path = slugs.length > 0 ? `/${slugs.join("/")}` : "/";
  const { next, previous } = devNeighbors(path, locale);
  const section = devGroup(path, locale);
  const canonicalUrl = canonicalUrlForRoute(path, locale);
  const markdownUrl = `/md/${locale}${path}`;

  return (
    <>
      <JsonLd
        code={breadcrumbJsonLd(
          [
            { name: "Home", path: "/" },
            { name: t("breadcrumb"), path: "/" },
            { name: data.title, path },
          ],
          locale
        )}
        id={`breadcrumb-jsonld-${slugs.join("-") || "home"}`}
      />

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="mx-auto w-full max-w-3xl min-w-0 lg:px-6">
          <main className="min-h-screen pt-6 pb-6 lg:pt-26 lg:pb-10">
            <header className="space-y-3">
              {section && (
                <Crumb href="/" root={t("breadcrumb")} section={section} />
              )}
              <h1 className="text-foreground font-sans text-2xl leading-tight text-balance sm:text-3xl">
                {data.title}
              </h1>
              <p className="text-muted-foreground font-sans text-base leading-normal text-pretty">
                {data.description}
              </p>
            </header>

            {pageToc.length > 0 && (
              <div className="my-6 xl:hidden">
                <Toc items={pageToc} />
              </div>
            )}

            <div className="text-muted-foreground mt-8 max-w-none font-sans text-base leading-relaxed">
              <Mdx />
            </div>

            {data.updatedAt && (
              <p className="text-muted-foreground mt-12 font-sans text-sm">
                {shared("updated", {
                  date: formatDate(data.updatedAt, locale),
                })}
              </p>
            )}

            {(previous || next) && (
              <nav
                aria-label={shared("pager")}
                className="border-border mt-8 grid grid-cols-2 gap-4 border-t pt-8"
              >
                {previous ? (
                  <a className="group" href={`/${locale}${previous.url}/`}>
                    <span className="text-muted-foreground flex items-center gap-1.5 font-sans text-sm">
                      <ArrowLeft className="size-3.5" />
                      {shared("previous")}
                    </span>
                    <span className="text-foreground mt-1 block font-sans text-base">
                      {previous.title}
                    </span>
                  </a>
                ) : (
                  <span />
                )}
                {next && (
                  <a
                    className="group text-right"
                    href={`/${locale}${next.url}/`}
                  >
                    <span className="text-muted-foreground flex items-center justify-end gap-1.5 font-sans text-sm">
                      {shared("next")}
                      <ArrowRight className="size-3.5" />
                    </span>
                    <span className="text-foreground mt-1 block font-sans text-base">
                      {next.title}
                    </span>
                  </a>
                )}
              </nav>
            )}
          </main>
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-24">
            <Panel
              canonicalUrl={canonicalUrl}
              items={pageToc}
              markdownUrl={markdownUrl}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
