import type { Node, Root } from "fumadocs-core/page-tree";

/**
 * The shape of a documentation surface's navigation, as plain data.
 *
 * The developer reference is built this way and needs
 * the same three things from a Fumadocs page tree: the sidebar's rows, the
 * index's card rows, and the flat reading order the pager walks. Fumadocs'
 * own tree carries `ReactNode` names and internal fields, and the sidebar is a
 * client component, so the tree is flattened here rather than serialised
 * across the boundary. The tree stays the source of order and grouping, which
 * is what `meta.json` is for; only these types leave the module.
 */
export interface NavLink {
	title: string;
	url: string;
}

export interface NavGroup {
	links: NavLink[];
	/** The `meta.json` folder title, or the separator that introduced it. */
	title: string;
}

/**
 * One row of the sidebar.
 *
 * A folder (or a separator) becomes a collapsible `group`; a page sitting at
 * the root of `meta.json` on its own becomes a plain `link`, because there is
 * nothing under it to expand and a disclosure arrow that reveals a single
 * child is a control that lies about what it does.
 */
export type NavItem =
	| ({ type: "group" } & NavGroup)
	| ({ type: "link" } & NavLink);

/** A navigation link plus the metadata the index cards show. */
export interface ReferenceCard extends NavLink {
	description: string;
	/** A key in `OSS_ICONS` from the page's frontmatter. */
	icon?: string;
}

export interface ReferenceCardGroup {
	cards: ReferenceCard[];
	title: string;
}

/** The card metadata a page contributes, looked up by its URL. */
export interface CardSource {
	description: string;
	icon?: string;
}

/** Page-tree names are `ReactNode`; ours are authored as plain strings. */
const nodeTitle = (name: Node["name"]): string =>
	typeof name === "string" ? name : "";

const linksOf = (nodes: readonly Node[]): NavLink[] =>
	nodes.flatMap((node) => {
		if (node.type === "page") {
			return { title: nodeTitle(node.name), url: node.url };
		}

		// One level of nesting is all the sidebar renders: a folder inside a
		// folder is flattened into its parent rather than silently dropped.
		if (node.type === "folder") {
			return linksOf(node.children);
		}

		return [];
	});

/**
 * The sidebar's rows, in `meta.json` order.
 *
 * A separator opens a group and a folder becomes one, which is what lets the
 * root `meta.json` read as the sidebar looks. A page at the root is a row of
 * its own unless a separator has opened a group above it, in which case it
 * joins that group.
 */
export function nav(tree: Root): NavItem[] {
	const items: NavItem[] = [];

	const groupFor = (title: string): NavGroup => {
		const current = items.at(-1);

		if (current?.type === "group" && current.title === title) {
			return current;
		}

		const next: NavItem = { links: [], title, type: "group" };
		items.push(next);
		return next;
	};

	let separator = "";

	for (const node of tree.children) {
		if (node.type === "separator") {
			separator = nodeTitle(node.name);
			groupFor(separator);
		}

		if (node.type === "folder") {
			const title = nodeTitle(node.name) || separator;
			groupFor(title).links.push(...linksOf(node.children));
		}

		if (node.type === "page") {
			const link = { title: nodeTitle(node.name), url: node.url };

			if (separator) {
				groupFor(separator).links.push(link);
			} else {
				items.push({ type: "link", ...link });
			}
		}
	}

	return items.filter((item) => item.type === "link" || item.links.length > 0);
}

/** Every group in the sidebar, dropping the rows that stand on their own. */
const groups = (items: readonly NavItem[]): NavGroup[] =>
	items.filter((item) => item.type === "group");

/**
 * The group a page sits in, or `undefined` when it is a row of its own.
 *
 * The page header uses this for its breadcrumb: a reader who followed a deep
 * link needs to be told which section of the sidebar they landed in, and a
 * page that belongs to no section has nothing to tell them.
 */
export const groupTitle = (
	items: readonly NavItem[],
	url: string,
): string | undefined =>
	groups(items).find((group) => group.links.some((link) => link.url === url))
		?.title;

/** Every page, flattened into the order the sidebar reads top to bottom. */
const links = (items: readonly NavItem[]): NavLink[] =>
	items.flatMap((item) =>
		item.type === "group" ? item.links : [{ title: item.title, url: item.url }],
	);

/**
 * The pages either side of `url`, for the footer pager.
 *
 * Derived from the same flattened order as the sidebar, so "next" is always
 * the link below the current one rather than a second definition of order.
 */
export function neighbors(
	items: readonly NavItem[],
	url: string,
): { next?: NavLink; previous?: NavLink } {
	const allLinks = links(items);
	const index = allLinks.findIndex((link) => link.url === url);

	if (index === -1) {
		return {};
	}

	return { next: allLinks[index + 1], previous: allLinks[index - 1] };
}

/**
 * The index's card rows, in the same order as the sidebar.
 *
 * Root-level pages share an untitled row on the index. They are standalone
 * links in the sidebar, but still need cards on the main page.
 *
 * The cards are built by looking each navigation link up in the corpus, so the
 * index cannot list a page the sidebar does not, and a page added to a
 * `meta.json` appears in both without a second edit.
 */
export function cardGroups(
	items: readonly NavItem[],
	pages: ReadonlyMap<string, CardSource>,
): ReferenceCardGroup[] {
	const cardsFor = (links: readonly NavLink[]): ReferenceCard[] =>
		links.flatMap((link) => {
			const page = pages.get(link.url);

			if (!page) {
				return [];
			}

			return {
				description: page.description,
				icon: page.icon,
				title: link.title,
				url: link.url,
			};
		});

	return items.reduce<ReferenceCardGroup[]>((rows, item) => {
		if (item.type === "group") {
			const cards = cardsFor(item.links);

			if (cards.length > 0) {
				rows.push({ cards, title: item.title });
			}

			return rows;
		}

		const cards = cardsFor([item]);
		const previous = rows.at(-1);

		if (cards.length === 0) {
			return rows;
		}

		if (previous?.title === "") {
			previous.cards.push(...cards);
			return rows;
		}

		rows.push({ cards, title: "" });
		return rows;
	}, []);
}
