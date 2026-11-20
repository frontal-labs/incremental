import type { ReactNode } from "react";
import { Header } from "@/components/header";
import { MobileNav } from "@/components/mobile-nav";

/**
 * The chrome every documentation surface shares: the header, a rail for the
 * navigation, and the page. No footer, because these pages end with their own
 * pager.
 *
 * The navigation itself is a prop rather than a fixed component. The developer
 * reference passes its collapsible sidebar, while everything around it stays
 * shared so the surface reads as one site.
 *
 * It supplies the `main` element that `SiteLayout` supplies on the other
 * surfaces, including the `viewTransitionName` the cross-fade animates.
 */
export async function Shell({
  children,
  label,
  sidebar,
  trigger,
}: {
  children: ReactNode;
  label: string;
  /** The navigation, rendered in the rail and again inside the mobile sheet. */
  sidebar: ReactNode;
  trigger: string;
}) {
  return (
    <>
      <Header />
      <div className="w-full" style={{ viewTransitionName: "root" }}>
        {/* Below `lg` the rail has nowhere to sit, so the same tree opens in a
            sheet from a control above the page. */}
        {/* `pt-14` is the height of the fixed header, so the control sits just
            under it. */}
        <div className="px-4 pt-16 pb-2 sm:px-6 lg:hidden">
          <MobileNav label={label} trigger={trigger}>
            {sidebar}
          </MobileNav>
        </div>

        {/* Swiss grid: two tracks across the full viewport. The rail owns the
            first, flush to the window's left edge, and the article owns the
            second and centres its own measure inside it.
            
            This replaces a centred `max-w-page` column whose rail faked its
            fill with a viewport-wide `before:` pseudo-element, because the
            band would otherwise stop in mid-air on a wide screen. With the
            grid itself spanning the viewport the fill is real, and the hack,
            its negative margins and its padding compensation all go. */}
        <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          {/* `top-14` clears the fixed header, and `border-border/60` matches
              the rule under `Header` so the two hairlines meet at the same
              weight where they cross. */}
          <aside className="hidden border-border/60 border-r bg-subtle/25 text-subtle-foreground lg:block dark:bg-subtle/75">
            {/* The rail is its own scroll container: bounded to the viewport
                below the header, so a tree taller than the screen scrolls
                inside the rail while the rail itself stays put. Without the
                height it grows to the tree and the sticky offset has nothing
                left to hold. */}
            <div className="sticky top-14 h-[calc(100svh-4rem)] px-4 sm:px-6">
              {sidebar}
            </div>
          </aside>

          {/* The measure is centred in its own track rather than stretched
              across it: the rail is hard left by design, and an article that
              ran the remaining width would put the text off-centre on the page
              and past a comfortable line length. `max-w-page` is the whole
              viewport's gutter token and is wider than this track, so it would
              never centre anything here. */}
          <div className="min-w-0 px-4 sm:px-6">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </div>
        </div>
      </div>
    </>
  );
}
