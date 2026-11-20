import { cn } from "@/lib/utils";
import { Footnote } from "@/components/footnote";

/**
 * The line that closes a documentation page: the copyright, the theme control
 * and the locale control.
 *
 * It carries no measure of its own. The footnote has to line up with whatever
 * sits above it, and that differs by page — an article centres its body on
 * `max-w-3xl` while an index runs the full `max-w-page` — so the caller passes
 * the container it wants matched. An article renders it inside the body column
 * and needs nothing; an index sits it outside `main` and repeats that element's
 * own measure.
 */
export const Footer = ({ className }: { className?: string }) => (
  <footer className="relative overflow-hidden bg-background">
    <div className={cn("py-6 sm:py-8", className)}>
      <Footnote />
    </div>
  </footer>
);
