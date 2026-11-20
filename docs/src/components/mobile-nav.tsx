"use client";

import { Button } from "@/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/sheet";
import { PanelLeft } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { usePathname } from "@/components/navigation";

export interface MobileNavProps {
  /** The surface's own navigation. */
  children: ReactNode;
  label: string;
  /** Button text, translated by the caller. */
  trigger: string;
}

/**
 * The same navigation, in a sheet, for widths where the sidebar cannot sit
 * beside the page.
 *
 * The sheet closes on navigation. Without that it stays open over the page the
 * reader just asked for, because the route changes without unmounting.
 */
export function MobileNav({
  children,
  label,
  trigger,
}: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger
        render={
          <Button className="font-sans" size="sm" variant="outline">
            <PanelLeft />
            {trigger}
          </Button>
        }
      />
      <SheetContent className="w-80 p-6 pt-14" side="left">
        <SheetHeader className="p-0">
          <SheetTitle className="font-sans text-base">{label}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 min-h-0 flex-1">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
