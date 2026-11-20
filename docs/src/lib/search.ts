import { devPages } from "@/lib/developers";

export interface SearchResult {
  category: string;
  description: string;
  href: string;
  keywords: string[];
  title: string;
}

const staticSearchResults: SearchResult[] = [
  {
    category: "Pages",
    description: "Incremental developer documentation reference.",
    href: "/",
    keywords: ["developers", "overview", "reference"],
    title: "Developer Reference",
  },
];

const normalize = (value: string): string => value.toLowerCase().trim();

function searchIndex(): SearchResult[] {
  const developers = devPages().flatMap((page) => {
    const slug = page.slugs.join("/");

    return {
      category: "Developers",
      description: page.data.description ?? "",
      href: slug ? `/${slug}` : "/",
      keywords: [...page.slugs, ...(page.data.keywords ?? [])],
      title: page.data.title ?? slug,
    };
  });

  return [...staticSearchResults, ...developers];
}

export function search(query: string): SearchResult[] {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return [];
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  return searchIndex()
    .map((item) => {
      const haystack = normalize(
        [item.title, item.description, item.category, ...item.keywords].join(" "),
      );

      const score = terms.reduce((accumulator, term) => {
        if (haystack.includes(term)) {
          accumulator += 2;
        }
        if (normalize(item.title).includes(term)) {
          accumulator += 4;
        }
        if (normalize(item.category).includes(term)) {
          accumulator += 1;
        }
        return accumulator;
      }, 0);

      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);
}
