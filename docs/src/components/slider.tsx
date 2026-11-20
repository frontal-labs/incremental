"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { useCallback, useMemo, useRef } from "react";
import { type HapticPattern, useHaptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";

type SliderProps = SliderPrimitive.Root.Props & {
  haptic?: boolean | HapticPattern;
};

type SliderBaseProps = Omit<SliderProps, "haptic">;

type HapticSliderProps = SliderBaseProps & {
  pattern: HapticPattern;
};

const USER_REASONS = new Set<SliderPrimitive.Root.ChangeEventReason>([
  "drag",
  "keyboard",
  "track-press",
]);

const POINTER_REASONS = new Set<SliderPrimitive.Root.CommitEventReason>([
  "drag",
  "track-press",
]);

// Minimum gap between drag ticks. Dense steps can change value on every
// pointer move; vibrating that often cancels the previous pulse and burns
// main-thread time for no perceptible gain.
const DRAG_TICK_INTERVAL_MS = 40;

function SliderBase({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderBaseProps) {
  const _values = useMemo(() => {
    if (Array.isArray(value)) {
      return value;
    }
    if (Array.isArray(defaultValue)) {
      return defaultValue;
    }
    return [min, max];
  }, [value, defaultValue, min, max]);

  return (
    <SliderPrimitive.Root
      className={cn(
        "data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full",
        className,
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      max={max}
      min={min}
      thumbAlignment="edge"
      value={value}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-disabled:opacity-50">
        <SliderPrimitive.Track
          className="relative grow select-none overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1 data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-1"
          data-slot="slider-track"
        >
          <SliderPrimitive.Indicator
            className="select-none bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
            data-slot="slider-range"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index: number) => (
          <SliderPrimitive.Thumb
            className="relative block size-3 shrink-0 select-none rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] after:absolute after:-inset-2 hover:ring-3 focus-visible:outline-hidden focus-visible:ring-3 active:ring-3 disabled:pointer-events-none disabled:opacity-50"
            data-slot="slider-thumb"
            key={index}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

function HapticSlider({
  pattern,
  onValueChange,
  onValueCommitted,
  ...props
}: HapticSliderProps) {
  const { trigger } = useHaptics();
  const lastDragTick = useRef(Number.NEGATIVE_INFINITY);

  const handleValueChange = useCallback<
    NonNullable<SliderPrimitive.Root.Props["onValueChange"]>
  >(
    (nextValue, eventDetails) => {
      const { reason } = eventDetails;
      if (USER_REASONS.has(reason)) {
        if (reason === "drag") {
          const now = performance.now();
          if (now - lastDragTick.current >= DRAG_TICK_INTERVAL_MS) {
            lastDragTick.current = now;
            trigger(pattern);
          }
        } else {
          trigger(pattern);
        }
      }
      onValueChange?.(nextValue, eventDetails);
    },
    [trigger, pattern, onValueChange],
  );

  const handleValueCommitted = useCallback<
    NonNullable<SliderPrimitive.Root.Props["onValueCommitted"]>
  >(
    (nextValue, eventDetails) => {
      if (POINTER_REASONS.has(eventDetails.reason)) {
        lastDragTick.current = Number.NEGATIVE_INFINITY;
        trigger("light");
      }
      onValueCommitted?.(nextValue, eventDetails);
    },
    [trigger, onValueCommitted],
  );

  return (
    <SliderBase
      onValueChange={handleValueChange}
      onValueCommitted={handleValueCommitted}
      {...props}
    />
  );
}

function Slider({ haptic = false, ...props }: SliderProps) {
  if (!haptic) {
    return <SliderBase {...props} />;
  }
  return (
    <HapticSlider pattern={haptic === true ? "selection" : haptic} {...props} />
  );
}

export { Slider, type SliderProps };
