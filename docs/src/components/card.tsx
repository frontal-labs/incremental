import type * as React from "react";
import { cn } from "@/lib/utils";

type CardProps = React.ComponentProps<"div"> & {
  size?: "default" | "sm";
};

function Card({ className, size = "default", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "@container/card group/card flex flex-col gap-4 overflow-hidden rounded-md bg-card py-4 text-card-foreground text-sm ring-1 ring-foreground/10 has-[>img:first-child]:pt-0 has-data-[slot=card-footer]:pb-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md",
        className,
      )}
      data-size={size}
      data-slot="card"
      {...props}
    />
  );
}

type CardHeaderProps = React.ComponentProps<"div">;

function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn(
        "@container/card-header group/card-header grid auto-rows-min items-start gap-1 rounded-t-md px-4",
        "group-data-[size=sm]/card:px-3",
        "[.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
        className,
      )}
      data-slot="card-header"
      {...props}
    />
  );
}

type CardTitleProps = React.ComponentProps<"div">;

function CardTitle({ className, ...props }: CardTitleProps) {
  return (
    <div
      className={cn(
        "font-medium text-base leading-snug",
        "group-data-[size=sm]/card:text-sm",
        className,
      )}
      data-slot="card-title"
      {...props}
    />
  );
}

type CardDescriptionProps = React.ComponentProps<"div">;

function CardDescription({ className, ...props }: CardDescriptionProps) {
  return (
    <div
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="card-description"
      {...props}
    />
  );
}

type CardActionProps = React.ComponentProps<"div">;

function CardAction({ className, ...props }: CardActionProps) {
  return (
    <div
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      data-slot="card-action"
      {...props}
    />
  );
}

type CardContentProps = React.ComponentProps<"div">;

function CardContent({ className, ...props }: CardContentProps) {
  return (
    <div
      className={cn("px-4 group-data-[size=sm]/card:px-3", className)}
      data-slot="card-content"
      {...props}
    />
  );
}

type CardFooterProps = React.ComponentProps<"div">;

function CardFooter({ className, ...props }: CardFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center rounded-b-md border-t bg-muted/25 p-4",
        "group-data-[size=sm]/card:p-3",
        className,
      )}
      data-slot="card-footer"
      {...props}
    />
  );
}

export {
  Card,
  CardAction,
  type CardActionProps,
  CardContent,
  type CardContentProps,
  CardDescription,
  type CardDescriptionProps,
  CardFooter,
  type CardFooterProps,
  CardHeader,
  type CardHeaderProps,
  type CardProps,
  CardTitle,
  type CardTitleProps,
};
