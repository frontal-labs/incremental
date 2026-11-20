"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "@/lib/utils";

type SeparatorProps = SeparatorPrimitive.Props;

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive
      className={cn(
        // Base UI emits `data-orientation="horizontal"|"vertical"` (verified in
        // @base-ui/react SeparatorDataAttributes). The previous
        // `data-horizontal:`/`data-vertical:` variants matched nothing, so every
        // Separator collapsed to 0px in both orientations.
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        className,
      )}
      data-slot="separator"
      orientation={orientation}
      {...props}
    />
  );
}

export { Separator, type SeparatorProps };
