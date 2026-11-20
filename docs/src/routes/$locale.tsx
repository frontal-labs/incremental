import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";

import {
  I18nProvider,
  messagesForLocale,
  translateMessage,
} from "@/components/i18n";
import { Shell } from "@/components/shell";
import { Sidebar } from "@/components/sidebar";
import { devNav } from "@/lib/developers";
import { isLocale, type Locale } from "@/lib/locales";

export const Route = createFileRoute("/$locale")({
  beforeLoad: ({ params }) => {
    if (!isLocale(params.locale)) {
      throw notFound();
    }
  },
  component: LocaleLayout,
});

function LocaleLayout() {
  const { locale: requestedLocale } = Route.useParams();
  const locale = requestedLocale as Locale;
  const messages = messagesForLocale(locale);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <Shell
        label={translateMessage(messages, "Developers.nav.label")}
        sidebar={
          <Sidebar
            items={devNav(locale)}
            label={translateMessage(messages, "Developers.nav.label")}
          />
        }
        trigger={translateMessage(messages, "Developers.nav.browse")}
      >
        <Outlet />
      </Shell>
    </I18nProvider>
  );
}
