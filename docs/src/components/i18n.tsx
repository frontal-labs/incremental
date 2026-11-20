import { createContext, useContext, useMemo } from "react";

import type { Locale } from "@/lib/locales";

import de from "@/locales/de.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import fr from "@/locales/fr.json";
import it from "@/locales/it.json";
import ja from "@/locales/ja.json";
import ko from "@/locales/ko.json";
import pt from "@/locales/pt.json";
import zh from "@/locales/zh.json";

export type Messages = Record<string, unknown>;

const MESSAGE_CATALOGUES: Record<Locale, Messages> = {
  de,
  en,
  es,
  fr,
  it,
  ja,
  ko,
  pt,
  zh,
};

interface I18nContextValue {
  locale: Locale;
  messages: Messages;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  messages: MESSAGE_CATALOGUES.en,
});

export function messagesForLocale(locale: Locale): Messages {
  return MESSAGE_CATALOGUES[locale];
}

export function I18nProvider({
  children,
  locale,
  messages = messagesForLocale(locale),
}: Readonly<{
  children: React.ReactNode;
  locale: Locale;
  messages?: Messages;
}>) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const getMessage = (messages: Messages, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, messages);

const formatMessage = (
  value: unknown,
  values?: Record<string, string | number>,
): string => {
  if (typeof value !== "string") {
    return value == null ? "" : String(value);
  }

  if (!values) {
    return value;
  }

  return value.replace(/\{(\w+)\}/gu, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
};

export function translateMessage(
  messages: Messages,
  path: string,
  values?: Record<string, string | number>,
): string {
  return formatMessage(getMessage(messages, path), values);
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export function useTranslations(namespace?: string) {
  const { messages } = useContext(I18nContext);
  const prefix = namespace ? `${namespace}.` : "";

  return (key: string, values?: Record<string, string | number>): string =>
    translateMessage(messages, `${prefix}${key}`, values);
}
