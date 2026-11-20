"use client";

import * as React from "react";

export interface UseControllableStateProps<T> {
  defaultValue?: T | undefined;
  onChange?: ((value: T) => void) | undefined;
  value?: T | undefined;
}

export function useControllableState<T>(
  props: UseControllableStateProps<T> & { defaultValue: T },
): [T, React.Dispatch<React.SetStateAction<T>>];
export function useControllableState<T>(
  props: UseControllableStateProps<T>,
): [T | undefined, React.Dispatch<React.SetStateAction<T | undefined>>];
export function useControllableState<T>({
  value: valueProp,
  defaultValue,
  onChange,
}: UseControllableStateProps<T>): [
  T | undefined,
  React.Dispatch<React.SetStateAction<T | undefined>>,
] {
  const [uncontrolledValue, setUncontrolledValue] = React.useState<
    T | undefined
  >(defaultValue);

  const isControlled = valueProp !== undefined;
  const value = isControlled ? valueProp : uncontrolledValue;

  // Mirrors the uncontrolled value so the setter can resolve updater
  // functions without depending on (and re-creating itself for) the state.
  const uncontrolledRef = React.useRef(uncontrolledValue);

  // Keeps `onChange` current without making it a `setValue` dependency, so
  // consumers may pass an inline callback without invalidating the setter.
  const onChangeRef = React.useRef(onChange);
  React.useInsertionEffect(() => {
    onChangeRef.current = onChange;
  });

  const setValue = React.useCallback(
    (nextValue: React.SetStateAction<T | undefined>) => {
      const previousValue = isControlled ? valueProp : uncontrolledRef.current;
      const resolvedValue =
        typeof nextValue === "function"
          ? (nextValue as (prev: T | undefined) => T | undefined)(previousValue)
          : nextValue;

      if (Object.is(resolvedValue, previousValue)) {
        return;
      }

      if (!isControlled) {
        uncontrolledRef.current = resolvedValue;
        setUncontrolledValue(resolvedValue);
      }

      onChangeRef.current?.(resolvedValue as T);
    },
    [isControlled, valueProp],
  );

  return [value, setValue];
}
