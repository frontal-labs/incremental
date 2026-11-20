import {
  CardContent,
  Card as CardPrimitive,
  type CardProps,
} from "@/components/card";
import { cn } from "@/lib/utils";
import type { TocItem } from "@/lib/toc";

export interface TocProps extends CardProps {
  items: readonly TocItem[];
}

export function Toc({ items, className, ...props }: TocProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <CardPrimitive
      className={cn("rounded-sm bg-subtle ring-border/80", className)}
      {...props}
    >
      <CardContent aria-label="On this page">
        <p className="mb-1 text-muted-foreground text-sm">Table of Contents</p>
        <ol className="space-y-1">
          {items.map((item: TocItem) => (
            <li className={item.depth > 2 ? "pl-3" : ""} key={item.url}>
              <a
                className="text-foreground text-sm leading-relaxed transition-colors hover:text-muted-foreground"
                href={item.url}
              >
                {item.title}
              </a>
            </li>
          ))}
        </ol>
      </CardContent>
    </CardPrimitive>
  );
}
