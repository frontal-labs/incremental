"use client";

import { Separator } from "@/components/separator";
import { cn } from "@/lib/utils";
import { Copy, FileText, Link2 } from "lucide-react";
import { useTranslations } from "@/components/i18n";
import { useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import type { TocItem } from "@/lib/toc";

export interface PanelProps {
  /** Absolute canonical URL of this page, for the copy control. */
  canonicalUrl: string;
  items: readonly TocItem[];
  /** Same-origin `/md/...` path serving this page's raw markdown. */
  markdownUrl: string;
}

const ACTION_CLASS =
  "flex w-full items-center gap-2 py-1.5 text-left font-sans text-muted-foreground text-sm transition-[transform,translate,scale,color] duration-160 ease-out hover:text-foreground active:scale-[0.97]";

/**
 * The right rail on a documentation page: where you are in this page, then
 * what you can do with it.
 *
 * The actions are the same three `PostActions` offers on an article, in list
 * form rather than a button group, and they reuse that component's message
 * namespace so the labels cannot drift apart. The markdown fetch starts when
 * the button is pressed and is cached on the ref, because Safari drops
 * clipboard permission once an `await` breaks the gesture chain.
 */
export function Panel({
  canonicalUrl,
  items,
  markdownUrl,
}: PanelProps) {
  const t = useTranslations("PostActions");
  const docs = useTranslations("Docs");
  const { toast } = useToast();
  const markdownRequest = useRef<Promise<string> | null>(null);

  const fetchMarkdown = useCallback(() => {
    markdownRequest.current ??= fetch(markdownUrl).then((response) => {
      if (!response.ok) {
        throw new Error(`Markdown request failed: ${response.status}`);
      }
      return response.text();
    });

    return markdownRequest.current;
  }, [markdownUrl]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      toast({ title: t("linkCopied"), variant: "success" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : undefined,
        title: t("copyFailed"),
        variant: "error",
      });
    }
  };

  const copyMarkdown = async () => {
    try {
      const pending = fetchMarkdown();

      // Hand the clipboard the promise itself where that is supported, so the
      // write stays inside the original gesture while the body is in flight.
      if (typeof ClipboardItem === "function" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": pending.then(
              (text) => new Blob([text], { type: "text/plain" })
            ),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(await pending);
      }

      toast({ title: t("markdownCopied"), variant: "success" });
    } catch (error) {
      // A failed fetch must not be cached as the answer for the next attempt.
      markdownRequest.current = null;
      toast({
        description: error instanceof Error ? error.message : undefined,
        title: t("copyFailed"),
        variant: "error",
      });
    }
  };

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <nav aria-label={docs("onThisPage")}>
          <p className="font-sans text-foreground text-sm">
            {docs("onThisPage")}
          </p>
          <ol className="mt-3 space-y-1.5">
            {items.map((item) => (
              <li key={item.url}>
                <a
                  className={cn(
                    "block font-sans text-muted-foreground text-sm leading-normal transition-colors hover:text-foreground",
                    item.depth > 2 && "pl-3"
                  )}
                  href={item.url}
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {items.length > 0 && <Separator />}

      <fieldset aria-label={docs("actions")} className="contents">
        <button className={ACTION_CLASS} onClick={copyLink} type="button">
          <Link2 className="size-3.5" />
          {t("copyLink")}
        </button>
        <button className={ACTION_CLASS} onClick={copyMarkdown} type="button">
          <Copy className="size-3.5" />
          {t("copyMarkdown")}
        </button>
        <a
          className={ACTION_CLASS}
          href={markdownUrl}
          rel="noopener"
          target="_blank"
        >
          <FileText className="size-3.5" />
          {docs("viewMarkdown")}
        </a>
      </fieldset>
    </div>
  );
}
