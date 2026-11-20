"use client";

import type { MDXComponents } from "mdx/types";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const mdxComponents: MDXComponents = {
  a: ({ className, ...props }: React.ComponentProps<"a">) => (
    <a className={cn("font-medium underline underline-offset-4", className)} {...props} />
  ),
  code: ({
    className,
    __raw__,
    __src__,
    ...props
  }: React.ComponentProps<"code"> & {
    __raw__?: string;
    __src__?: string;
  }) => {
    // Inline code. `before:content-none` and its `after` twin undo the
    // backtick the typography plugin injects around every `code` element,
    // which otherwise renders literally next to our own styling.
    if (typeof props.children === "string") {
      return (
        <code
          className={cn(
            "relative rounded-md border border-border bg-muted px-[0.3rem] py-[0.15rem] font-mono text-[.8125rem] text-foreground outline-none",
            "break-words decoration-clone",
            "before:content-none after:content-none",
            className
          )}
          {...props}
        />
      );
    }

    // Default codeblock: highlighted tokens from `rehype-pretty-code`.
    return (
      <>
        <code className={cn("font-mono", className)} {...props} />
      </>
    );
  },
  figcaption: ({
    className,
    children,
    ...props
  }: React.ComponentProps<"figcaption">) => {
    const language =
      "data-language" in props && typeof props["data-language"] === "string"
        ? props["data-language"]
        : null;

    return (
      <figcaption
        className={cn(
          "flex items-center gap-2 border-border border-b px-4 py-2.5 font-mono text-[.8125rem] text-muted-foreground",
          "[&_svg]:size-4.5 [&_svg]:text-muted-foreground [&_svg]:opacity-70 sm:[&_svg]:size-4",
          className
        )}
        {...props}
      >
        {language && <span>{language}</span>}
        {children}
      </figcaption>
    );
  },
  // The code block itself: the figure owns the surface, the border and the
  // clipping, so the caption bar, the scroll area and the copy button all sit
  // inside one rounded card instead of three unrelated boxes.
  figure: ({ className, ...props }: React.ComponentProps<"figure">) => {
    const isCodeBlock = "data-rehype-pretty-code-figure" in props;

    return (
      <figure
        className={cn(
          "my-6",
          isCodeBlock &&
            "relative overflow-hidden rounded-lg border border-border bg-code",
          className
        )}
        {...props}
      />
    );
  },
  h1: ({ className, ...props }: React.ComponentProps<"h1">) => (
    <h1 className={cn("mt-2 font-heading font-semibold text-3xl text-foreground", className)} {...props} />
  ),
  h2: ({ className, children, ...props }: React.ComponentProps<"h2">) => {
    const id = props.id || children?.toString().replace(/ /g, "-").replace(/'/g, "").replace(/\?/g, "").toLowerCase();
    return (
      <h2 {...props} className={cn("mt-12 font-heading font-semibold text-2xl text-foreground first:mt-0 lg:mt-16 [&+p]:mt-4! *:[code]:text-2xl", className)} id={id}>
        <a className="no-underline underline-offset-4 hover:underline" href={`#${id}`}>{children}</a>
      </h2>
    );
  },
  h3: ({ className, children, ...props }: React.ComponentProps<"h3">) => {
    const id = props.id || children?.toString().replace(/ /g, "-").replace(/'/g, "").replace(/\?/g, "").toLowerCase();
    return (
      <h3 {...props} className={cn("mt-8 font-semibold text-foreground text-lg *:[code]:text-lg", className)} id={id}>
        <a className="no-underline underline-offset-4 hover:underline" href={`#${id}`}>{children}</a>
      </h3>
    );
  },
  h4: ({ className, ...props }: React.ComponentProps<"h4">) => (
    <h4 className={cn("mt-8 font-medium text-foreground tracking-tight", className)} {...props} />
  ),
  h5: ({ className, ...props }: React.ComponentProps<"h5">) => (
    <h5 className={cn("mt-8 font-medium text-foreground text-lg tracking-tight", className)} {...props} />
  ),
  h6: ({ className, ...props }: React.ComponentProps<"h6">) => (
    <h6 className={cn("mt-8 font-medium text-base text-foreground tracking-tight", className)} {...props} />
  ),
  p: ({ className, ...props }: React.ComponentProps<"p">) => (
    <p className={cn("not-first:mt-6 text-muted-foreground leading-relaxed", className)} {...props} />
  ),
  ul: ({ className, ...props }: React.ComponentProps<"ul">) => (
    <ul className={cn("my-6 ml-6 list-disc text-muted-foreground", className)} {...props} />
  ),
  ol: ({ className, ...props }: React.ComponentProps<"ol">) => (
    <ol className={cn("my-6 ml-6 list-decimal text-muted-foreground", className)} {...props} />
  ),
  li: ({ className, ...props }: React.ComponentProps<"li">) => (
    <li className={cn("mt-2 text-muted-foreground", className)} {...props} />
  ),
  blockquote: ({ className, ...props }: React.ComponentProps<"blockquote">) => (
    <blockquote className={cn("my-6 border-primary border-l-2 ps-6 text-muted-foreground italic", "[&_p]:before:content-none [&_p]:after:content-none", className)} {...props} />
  ),
  hr: ({ ...props }: React.ComponentProps<"hr">) => (
    <hr className="my-8 border-border" {...props} />
  ),
  img: ({ className, alt, ...props }: React.ComponentProps<"img">) => (
    <img alt={alt} className={cn("rounded-md", className)} {...props} />
  ),
  table: ({ className, ...props }: React.ComponentProps<"table">) => (
    <div className="my-6 rounded-lg border border-border overflow-auto">
      <table className={cn("relative my-0 w-full min-w-[40rem] border-collapse border-none text-left text-base", className)} {...props} />
    </div>
  ),
  tbody: ({ className, ...props }: React.ComponentProps<"tbody">) => (
    <tbody className={cn("text-muted-foreground", className)} {...props} />
  ),
  td: ({ className, ...props }: React.ComponentProps<"td">) => (
    <td className={cn("px-5 py-3.5 text-left align-top leading-relaxed [[align=center]]:text-center [[align=right]]:text-right", className)} {...props} />
  ),
  th: ({ className, ...props }: React.ComponentProps<"th">) => (
    <th className={cn("bg-subtle px-5 py-3.5 text-left align-bottom font-medium text-foreground leading-relaxed [[align=center]]:text-center [[align=right]]:text-right", className)} {...props} />
  ),
  thead: ({ className, ...props }: React.ComponentProps<"thead">) => (
    <thead className={cn("border-border border-b bg-subtle", className)} {...props} />
  ),
  tr: ({ className, ...props }: React.ComponentProps<"tr">) => (
    <tr className={cn("m-0 border-border border-b last:border-b-0", className)} {...props} />
  ),
  strong: ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className={cn("font-medium text-foreground", className)} {...props} />
  ),
};

export function useMDXComponents(): MDXComponents {
  return mdxComponents;
}
