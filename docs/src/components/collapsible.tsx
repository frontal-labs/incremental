"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cn } from "@/lib/utils";

type CollapsibleProps = CollapsiblePrimitive.Root.Props;

function Collapsible({ ...props }: CollapsibleProps) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

type CollapsibleTriggerProps = CollapsiblePrimitive.Trigger.Props;

function CollapsibleTrigger({ ...props }: CollapsibleTriggerProps) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  );
}

type CollapsibleContentProps = CollapsiblePrimitive.Panel.Props;

function CollapsibleContent({ className, ...props }: CollapsibleContentProps) {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        "disclosure-panel h-(--collapsible-panel-height) overflow-hidden ease-disclosure data-ending-style:h-0 data-starting-style:h-0",
        className,
      )}
      data-slot="collapsible-content"
      {...props}
    />
  );
}

export {
  Collapsible,
  CollapsibleContent,
  type CollapsibleContentProps,
  type CollapsibleProps,
  CollapsibleTrigger,
  type CollapsibleTriggerProps,
};
