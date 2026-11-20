"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/collapsible";
import { ScrollArea } from "@/components/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { NavItem } from "@/lib/nav";
import { Link, usePathname } from "@/components/navigation";

export interface SidebarProps {
  /** Plain navigation data in `meta.json` order. */
  items: readonly NavItem[];
  /** Accessible name, translated by the caller. */
  label: string;
}

/**
 * Trailing slashes are on for this site, so `usePathname()` reports
 * `/x/` while the page tree stores `/x`. Comparing them raw leaves
 * every section closed and no link ever marked current.
 */
const samePath = (a: string, b: string): boolean =>
  a.replace(/\/$/, "") === b.replace(/\/$/, "");

/**
 * Transition-driven, and driven by the design system rather than here.
 *
 * `CollapsibleContent` ships the height transition itself as of
 * `@incremental-labs/ui` 0.5.0 (`disclosure-panel` + `h-(--collapsible-panel-height)`).
 * The local `accordion-down`/`accordion-up` keyframes this used to carry were a
 * workaround for the version that shipped no motion at all; keeping them now
 * gives the panel a named animation *and* a non-zero transition duration, which
 * is the one combination Base UI refuses to guess at and warns about on mount.
 */
const PANEL_CLASS = cn(
  "overflow-hidden",
  "[&[hidden]:not([hidden='until-found'])]:hidden"
);

/** A page inside a group: indented, hanging off the group's rule. */
const CHILD_LINK_CLASS =
  "-ml-px block border-transparent border-l py-1.5 pl-4 font-sans text-sm transition-colors";

/** A row that stands on its own, so it sits on the group titles' own line. */
const ROOT_ROW_CLASS =
  "flex w-full items-center justify-between py-1.5 font-sans text-sm transition-colors";

/**
 * The documentation navigation: one collapsible section per `meta.json`
 * folder, with the section holding the current page open, and a plain link for
 * any page that sits at the root on its own.
 *
 * Sections collapse because the corpus is grouped by task, and a reader
 * working through Guides has no use for twenty Reference rows in their
 * peripheral vision.
 *
 * Each section is controlled rather than merely seeded with `defaultOpen`.
 * The sidebar lives in the layout, so it survives navigation: an uncontrolled
 * panel would honour the path once, on first mount, and from then on show
 * whatever the reader last left open regardless of the page beside it. The
 * open state is therefore the path's answer unless the reader has overruled
 * it here, and the override is dropped for whichever section the reader
 * navigates into, so following a deep link always opens the section it is in.
 */
export function Sidebar({ items, label }: SidebarProps) {
  const pathname = usePathname();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const holdsCurrentPage = (item: NavItem): boolean =>
    item.type === "group" &&
    item.links.some((link) => samePath(pathname, link.url));

  useEffect(() => {
    setToggled((previous) => {
      const active = items.find(
        (item) =>
          item.type === "group" &&
          item.links.some((link) => samePath(pathname, link.url))
      );

      if (!(active && active.title in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[active.title];
      return next;
    });
  }, [pathname, items]);

  return (
    <nav aria-label={label} className="flex h-full min-h-0 w-full flex-col">
      {/* The scroll area is the flexible child of a full-height column, so the
          tree scrolls inside the rail instead of pushing it past the viewport
          and taking the sticky position with it. */}
      <ScrollArea className="min-h-0 flex-1">
        {/* Horizontal padding belongs to the shell's rail, so the list stays
            flush and the chevron sits the same distance from the right edge as
            the titles do from the left. */}
        <div className="space-y-1 pb-8">
          {items.map((item) => {
            if (item.type === "link") {
              const active = samePath(pathname, item.url);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    ROOT_ROW_CLASS,
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  href={item.url}
                  key={item.url}
                >
                  {item.title}
                </Link>
              );
            }

            const active = holdsCurrentPage(item);
            const open = toggled[item.title] ?? active;

            return (
              <Collapsible
                className="group"
                key={item.title}
                onOpenChange={(next) =>
                  setToggled((previous) => ({
                    ...previous,
                    [item.title]: next,
                  }))
                }
                open={open}
              >
                <CollapsibleTrigger
                  className={cn(
                    ROOT_ROW_CLASS,
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {item.title}
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 transition-transform duration-200 group-data-[open]:rotate-90 motion-reduce:transition-none"
                  />
                </CollapsibleTrigger>
                {/* The height animation is Base UI's own: the panel exposes
                    its measured height as `--collapsible-panel-height`, and
                    the starting and ending styles collapse it to zero, so the
                    transition has two real endpoints to travel between. */}
                <CollapsibleContent className={PANEL_CLASS}>
                  <ul className="mt-1 mb-2 border-border border-l">
                    {item.links.map((link) => {
                      const active = samePath(pathname, link.url);

                      return (
                        <li key={link.url}>
                          <Link
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              CHILD_LINK_CLASS,
                              active
                                ? "border-foreground text-foreground"
                                : "text-muted-foreground hover:border-border hover:text-foreground"
                            )}
                            href={link.url}
                          >
                            {link.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </nav>
  );
}
