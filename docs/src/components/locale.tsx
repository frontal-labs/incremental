"use client";

import {
	Select,
	SelectContent,
	type SelectContentProps,
	SelectItem,
	SelectTrigger,
	type SelectTriggerProps,
	SelectValue,
} from "@/components/select";
import { useLocale, useTranslations } from "@/components/i18n";
import { isLocale, LOCALES, type WebsiteLocale } from "@/lib/locales";
import { usePathname, useRouter, useSearchParams } from "@/components/navigation";
import { cn } from "@/lib/utils";

export interface LocaleProps extends SelectTriggerProps {
	align: SelectContentProps["align"];
	/** Use pill shape (fully rounded) instead of default rounded */
	side: SelectContentProps["side"];
}

export function Locale({ side, align, className, ...props }: LocaleProps) {
	const t = useTranslations("LocaleSelector");
	const requestedLocale = useLocale();
	const pathname = usePathname();
	const router = useRouter();
	// Keep the query string when switching locale, for example on
	// `/pricing?currency=EUR`.
	const searchParams = useSearchParams();

	const locale = isLocale(requestedLocale) ? requestedLocale : "en";
	const currentLocale = LOCALES.find((item) => item.code === locale);

	return (
		<Select
			onValueChange={(nextLocale) => {
				if (nextLocale && isLocale(nextLocale)) {
					const query = searchParams.toString();
					router.replace(`${pathname}${query ? `?${query}` : ""}`, {
						locale: nextLocale,
					});
				}
			}}
			value={locale}
		>
			<SelectTrigger
				aria-label={t("documentLanguage")}
				className={cn("w-fit rounded-full", className)}
				{...props}
			>
				{/*
          Endonyms, not exonyms: a reader looking for Japanese scans for
          "日本語", not for the English word "Japanese" they may not read.
        */}
				<SelectValue>{currentLocale?.nativeLabel ?? t("english")}</SelectValue>
			</SelectTrigger>
			<SelectContent align={align} className="p-1" side={side}>
				{LOCALES.map((item: WebsiteLocale) => (
					<SelectItem key={item.code} value={item.code}>
						<span lang={item.code}>{item.nativeLabel}</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
