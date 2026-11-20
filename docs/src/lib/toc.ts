import type { TOCItemType } from "fumadocs-core/toc";

/** The smallest Fumadocs page shape needed to read its generated TOC. */
export interface PageWithToc {
  data: {
    toc: readonly TOCItemType[];
  };
}

export type TocItem = TOCItemType;

export interface TocFilter {
  maxDepth?: number;
  minDepth?: number;
}

/** Return the generated table of contents for any Fumadocs page. */
export function toc<TPage extends PageWithToc>(
  page: TPage,
  filter: TocFilter = {}
): readonly TocItem[] {
  const { minDepth = 2, maxDepth = Number.POSITIVE_INFINITY } = filter;

  return page.data.toc.filter(
    (item) => item.depth >= minDepth && item.depth <= maxDepth
  );
}
