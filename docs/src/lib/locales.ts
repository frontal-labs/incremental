export const LOCALE_CODES = [
  "en",
  "de",
  "es",
  "fr",
  "it",
  "ja",
  "ko",
  "pt",
  "zh",
] as const;

export type Locale = (typeof LOCALE_CODES)[number];

export const LOCALES = [
  { code: "en", label: "English", nativeLabel: "English", shortLabel: "EN" },
  {
    code: "pt",
    label: "Portuguese",
    nativeLabel: "Português",
    shortLabel: "PT",
  },
  { code: "de", label: "German", nativeLabel: "Deutsch", shortLabel: "DE" },
  { code: "it", label: "Italian", nativeLabel: "Italiano", shortLabel: "IT" },
  { code: "es", label: "Spanish", nativeLabel: "Español", shortLabel: "ES" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", shortLabel: "JA" },
  { code: "ko", label: "Korean", nativeLabel: "한국어", shortLabel: "KO" },
  { code: "fr", label: "French", nativeLabel: "Français", shortLabel: "FR" },
  { code: "zh", label: "Chinese", nativeLabel: "中文", shortLabel: "ZH" },
] as const satisfies readonly {
  code: Locale;
  label: string;
  nativeLabel: string;
  shortLabel: string;
}[];

export type WebsiteLocale = (typeof LOCALES)[number];

export function isLocale(value: string): value is Locale {
  return LOCALES.some((locale: WebsiteLocale) => locale.code === value);
}
