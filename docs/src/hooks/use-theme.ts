import { atom } from "jotai";
import type { SectionTheme } from "@/lib/section";

/**
 * The theme of the region the header is currently floating over.
 *
 * The header is a sibling of `<main>` in the locale layout, so no section can
 * pass this down as a prop — it has to travel across the tree. The atom lives
 * beside the components that consume it.
 */
export const activeThemeAtom = atom<SectionTheme>("default");
