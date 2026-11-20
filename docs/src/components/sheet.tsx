"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/button";

type SheetProps = SheetPrimitive.Root.Props;

function Sheet({ ...props }: SheetProps) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

type SheetTriggerProps = SheetPrimitive.Trigger.Props;

function SheetTrigger({ ...props }: SheetTriggerProps) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

type SheetCloseProps = SheetPrimitive.Close.Props;

function SheetClose({ ...props }: SheetCloseProps) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

type SheetPortalProps = SheetPrimitive.Portal.Props;

function SheetPortal({ ...props }: SheetPortalProps) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

type SheetOverlayProps = SheetPrimitive.Backdrop.Props;

function SheetOverlay({ className, ...props }: SheetOverlayProps) {
  return (
    <SheetPrimitive.Backdrop
      className={cn(
        "data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 z-50 bg-black/10 duration-250 data-closed:pointer-events-none data-closed:animate-out data-open:animate-in data-ending-style:opacity-0 data-starting-style:opacity-0 data-closed:duration-150 data-closed:ease-exit supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      data-slot="sheet-overlay"
      {...props}
    />
  );
}

type SheetContentProps = SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
  dark?: boolean;
};

function SheetContent({
  className,
  children,
  dark = true,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal className={cn(dark && "dark")}>
      <SheetOverlay />
      <SheetPrimitive.Popup
        className={cn(
          "data-[side=right]:data-closed:slide-out-to-right-full data-[side=right]:data-open:slide-in-from-right-full data-[side=left]:data-closed:slide-out-to-left-full data-[side=left]:data-open:slide-in-from-left-full data-[side=top]:data-closed:slide-out-to-top-full data-[side=top]:data-open:slide-in-from-top-full data-closed:fade-out-0 data-open:fade-in-0 data-[side=bottom]:data-closed:slide-out-to-bottom-full data-[side=bottom]:data-open:slide-in-from-bottom-full fixed z-50 flex flex-col gap-4 bg-card bg-clip-padding text-card-foreground text-sm shadow-lg transition duration-400 ease-drawer data-[side=bottom]:inset-x-0 data-[side=top]:inset-x-0 data-[side=left]:inset-y-0 data-[side=right]:inset-y-0 data-[side=top]:top-0 data-[side=right]:right-0 data-[side=bottom]:bottom-0 data-[side=left]:left-0 data-[side=bottom]:h-auto data-[side=left]:h-full data-[side=right]:h-full data-[side=top]:h-auto data-[side=left]:w-3/4 data-[side=right]:w-3/4 data-closed:animate-out data-open:animate-in data-[side=bottom]:border-t data-[side=left]:border-r data-[side=top]:border-b data-[side=right]:border-l data-closed:duration-300 data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className,
        )}
        data-side={side}
        data-slot="sheet-content"
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            nativeButton
            render={
              <Button
                className="absolute top-3 right-3 hover:bg-transparent dark:hover:bg-transparent"
                size="icon-sm"
                variant="ghost"
              >
                <X />
                <span className="sr-only">Close</span>
              </Button>
            }
          />
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

type SheetHeaderProps = React.ComponentProps<"div">;

function SheetHeader({ className, ...props }: SheetHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-0.5 p-4", className)}
      data-slot="sheet-header"
      {...props}
    />
  );
}

type SheetFooterProps = React.ComponentProps<"div">;

function SheetFooter({ className, ...props }: SheetFooterProps) {
  return (
    <div
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      data-slot="sheet-footer"
      {...props}
    />
  );
}

type SheetTitleProps = SheetPrimitive.Title.Props;

function SheetTitle({ className, ...props }: SheetTitleProps) {
  return (
    <SheetPrimitive.Title
      className={cn("font-medium text-base text-foreground", className)}
      data-slot="sheet-title"
      {...props}
    />
  );
}

type SheetDescriptionProps = SheetPrimitive.Description.Props;

function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  return (
    <SheetPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  type SheetCloseProps,
  SheetContent,
  type SheetContentProps,
  SheetDescription,
  type SheetDescriptionProps,
  SheetFooter,
  type SheetFooterProps,
  SheetHeader,
  type SheetHeaderProps,
  type SheetOverlayProps,
  type SheetPortalProps,
  type SheetProps,
  SheetTitle,
  type SheetTitleProps,
  SheetTrigger,
  type SheetTriggerProps,
};
