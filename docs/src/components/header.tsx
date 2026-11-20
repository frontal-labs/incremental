"use client";

import { Button } from "@/components/button";
import { Icons } from "@/components/icons";
import { Link } from "@/components/link";
import { siteRoutes, siteUrls } from "@/config/config";
import { useTranslations } from "@/components/i18n";

/** The compact header shared by the OSS and developer reference pages. */
export function Header() {
	const t = useTranslations("Header");

	return (
		<header className="fixed top-0 right-0 left-0 z-50 border-border/60 border-b bg-background/95 backdrop-blur-md md:right-(--chat-rail-width)">
			<div className="flex h-14 w-full items-center justify-between px-4 py-3 sm:px-6">
				<Link
					aria-label={t("homeLabel")}
					className="flex h-5 items-center gap-1.5 transition-opacity duration-200 hover:opacity-80"
					href={siteRoutes.home}
				>
					<Icons.Wordmark className="h-4 w-auto" />
					<span
						aria-hidden="true"
						className="text-foreground font-sans text-lg leading-none"
					>
						/
					</span>
					<span
						aria-hidden="true"
						className="text-foreground font-sans text-lg font-medium leading-none tracking-tight"
					>
						Incremental
					</span>
				</Link>

				<Button
					nativeButton={false}
					render={<Link href={siteUrls.auth} />}
					shape="pill"
					size="sm"
					variant="secondary"
				>
					{t("signIn")}
				</Button>
			</div>
		</header>
	);
}
