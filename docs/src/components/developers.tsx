import { cn } from "@/lib/utils";
import { CardGrid } from "@/components/card-grid";
import { Footer } from "@/components/footer";
import {
  HERO_DESCRIPTION_CLASS,
  HERO_TITLE_CLASS,
} from "@/components/hero";
import type { ReferenceCard, ReferenceCardGroup } from "@/lib/nav";
import { useTranslations } from "@/components/i18n";

export interface DevelopersProps {
  /** One card row per sidebar group, in the same order. */
  groups: readonly ReferenceCardGroup[];
  /** The lead row: the pages marked `featured` in their frontmatter. */
  popular: readonly ReferenceCard[];
}

/**
 * The developer reference index.
 *
 * Built from the developer page tree, so the index and
 * the sidebar cannot disagree: a page added to a `meta.json` gets a card here,
 * and the card's words are that page's own title and description rather than a
 * second summary that ages separately.
 */
export function Developers({ groups, popular }: DevelopersProps) {
  const copy = useTranslations("Developers");
  const popularUrls = new Set(popular.map((card) => card.url));
  const remainingGroups = groups
    .map((group) => ({
      ...group,
      cards: group.cards.filter((card) => !popularUrls.has(card.url)),
    }))
    .filter((group) => group.cards.length > 0);

  return (
    <>
      <main className="mx-auto mb-12 min-h-screen w-full max-w-page lg:px-6">
        <header className="pt-6 pb-6 lg:pt-28 lg:pb-10">
          <h1 className={HERO_TITLE_CLASS}>{copy("hero.title")}</h1>
          <p className={cn("mt-4", HERO_DESCRIPTION_CLASS)}>
            {copy("hero.description")}
          </p>
        </header>

        <CardGrid cards={popular} title={copy("startHere")} />

        {remainingGroups.map((group, index) => (
          <CardGrid
            cards={group.cards}
            key={group.title || `ungrouped-${index}`}
            title={group.title || undefined}
          />
        ))}
      </main>

      <Footer className="mx-auto w-full max-w-page lg:px-6" />
    </>
  );
}
