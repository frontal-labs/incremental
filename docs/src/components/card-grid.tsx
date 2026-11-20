import { ossIcon } from "@/components/icons";
import type { ReferenceCard } from "@/lib/nav";
import { Link } from "@/components/navigation";
import { cn } from "@/lib/utils";

export interface CardGridProps {
	cards: readonly ReferenceCard[];
	title?: string;
}

/**
 * One titled row of documentation cards.
 *
 * The card is two stacked halves: a glyph on a quiet panel, then the title and
 * the page's own description under a hairline. The split is what lets a reader
 * scan a row by shape before reading any of it, and it reuses the surfaces the
 * rest of the site already has (`bg-subtle`, `border-border`) rather than
 * introducing a card treatment that exists only here.
 */
export function CardGrid({ cards, title }: CardGridProps) {
	if (cards.length === 0) {
		return null;
	}

	return (
		<section className="mt-12 first:mt-0">
			{title && <h2 className="font-sans text-foreground text-lg">{title}</h2>}

			<ul
				className={cn(
					"reveal-children grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-4",
					title && "mt-4",
				)}
			>
				{cards.map((card) => {
					const Icon = ossIcon(card.icon);

					return (
						<li key={card.url}>
							<Link
								className="group flex h-full flex-col overflow-hidden rounded-md border border-border transition-colors hover:border-foreground/20"
								href={card.url}
							>
								<div className="flex h-24 items-center justify-center bg-subtle transition-colors group-hover:bg-muted/50">
									<Icon
										aria-hidden="true"
										className="size-5 text-muted-foreground transition-colors group-hover:text-foreground"
									/>
								</div>
								<div className="flex-1 border-border border-t p-4">
									<p className="font-sans text-base text-foreground">
										{card.title}
									</p>
									<p className="mt-1 text-pretty font-sans text-muted-foreground text-sm leading-normal">
										{card.description}
									</p>
								</div>
							</Link>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
