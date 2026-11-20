import { createFileRoute } from "@tanstack/react-router";

import { Developers } from "@/components/developers";
import { messagesForLocale, translateMessage } from "@/components/i18n";
import { devCards, devFeatured } from "@/lib/developers";
import { isLocale, type Locale } from "@/lib/locales";
import { pageMetadata } from "@/lib/metadata";

export const Route = createFileRoute("/$locale/")({
  beforeLoad: ({ params }) => {
    if (!isLocale(params.locale)) {
      throw new Error("Invalid locale");
    }
  },
  head: ({ params }) => {
    const locale = params.locale as Locale;
    const messages = messagesForLocale(locale);
    const meta = pageMetadata({
      description: translateMessage(messages, "Developers.meta.description"),
      keywords: [
        "Incremental SDK",
        "Incremental API",
        "TypeScript SDK",
        "Python SDK",
        "REST API",
        "API reference",
      ],
      locale,
      path: "/",
      title: translateMessage(messages, "Developers.meta.title"),
    });

    return {
      links: [{ href: meta.alternates?.canonical ?? "", rel: "canonical" }],
      meta: [
        { content: meta.description, name: "description" },
        { title: meta.title.absolute },
        { content: meta.openGraph?.title, property: "og:title" },
        { content: meta.openGraph?.description, property: "og:description" },
      ],
    };
  },
  component: HomePage,
});

function HomePage() {
  const { locale: requestedLocale } = Route.useParams();
  const locale = requestedLocale as Locale;

  return <Developers groups={devCards(locale)} popular={devFeatured(locale)} />;
}
