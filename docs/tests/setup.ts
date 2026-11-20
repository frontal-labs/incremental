import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

const createStorage = (): Storage => {
  const values = new Map<string, string>();

  return {
    clear: () => {
      values.clear();
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
  };
};

if (typeof window !== "undefined") {
  if (!window.localStorage) {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorage(),
    });
  }

  if (!window.sessionStorage) {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createStorage(),
    });
  }
}
