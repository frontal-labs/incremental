import {
	Link as RouterLink,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

import { useLocale } from "@/components/i18n";
import { isLocale, type Locale } from "@/lib/locales";

type RouterLinkProps = ComponentProps<typeof RouterLink>;

export interface NavigationLinkProps
	extends Omit<RouterLinkProps, "children" | "to" | "params"> {
	href: string;
	children?: ReactNode;
}

const isExternal = (href: string): boolean =>
/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href);

export const localizedPath = (href: string, locale: Locale): string => {
	if (
		isExternal(href) ||
		href.startsWith("#") ||
		href.startsWith("/") === false ||
		href.startsWith(`/${locale}`)
	) {
		return href;
	}

	if (/^\/(?:api|md(?:\/|$)|_next|images|favicon\.ico)/u.test(href)) {
		return href;
	}

	return href === "/" ? `/${locale}/` : `/${locale}${href}`;
};

export function Link({ href, ...props }: NavigationLinkProps) {
	const locale = useLocale();
	const destination = localizedPath(href, locale);

	if (isExternal(destination)) {
		return <a href={destination} {...props} />;
	}

	return <RouterLink to={destination as never} {...props} />;
}

export function usePathname(): string {
	return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
	return new URLSearchParams(useLocation().search);
}

export function useRouter() {
	const navigate = useNavigate();

	return {
		replace: (href: string, options?: { locale?: Locale }) => {
			const locale = options?.locale ?? getLocaleFromPath(href) ?? "en";
			return navigate({
				replace: true,
				to: localizedPath(stripLocale(href), locale) as never,
			});
		},
	};
}

const getLocaleFromPath = (path: string): Locale | undefined => {
	const candidate = path.split("/")[1];
	return candidate && isLocale(candidate) ? candidate : undefined;
};

const stripLocale = (path: string): string => {
	const locale = getLocaleFromPath(path);
	return locale ? path.slice(locale.length + 1) || "/" : path;
};
