// Reading what cargo and rustc record (spec/adapters/clippy.md, "What the recorder
// can observe"): each compile unit's dep-info file, and each build script's output.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Makefile-style dep-info: "target: dep dep ...", one rule per line. A space in a
// path is escaped as "\ ", and a line ending in "\" continues onto the next line.
// Lines starting with "#" (env-dep records) carry no file dependencies.
export function parseDepInfo(text: string): string[] {
  const deps = new Set<string>();
  for (const line of text.replace(/\\\n/g, " ").split("\n")) {
    if (line.trim() !== "" && !line.startsWith("#")) {
      const sep = separatorOf(line);
      if (sep >= 0) {
        for (const token of line.slice(sep + 1).match(/(?:\\ |[^ ])+/g) ?? []) {
          deps.add(token.replace(/\\ /g, " "));
        }
      }
    }
  }
  return [...deps];
}

// The first colon that ends a target: a colon followed by a space or the end of
// the line, and not escaped.
function separatorOf(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ":" && (i + 1 === line.length || line[i + 1] === " ") && line[i - 1] !== "\\")
      return i;
  }
  return -1;
}

const LIB_EXTENSIONS = new Set([".rmeta", ".rlib", ".so", ".dylib", ".a"]);

// The dep-info file for a compile unit, from one of its output filenames. For
// rlib and rmeta outputs rustc writes "<stem without lib>.d" next to them; for a
// build script executable it writes "build_script_build-<hash>.d" in the same
// build directory. Returns null when no such file is present.
export function depInfoFor(filename: string, kinds: string[]): string | null {
  const dir = path.dirname(filename);
  const ext = path.extname(filename);
  let stem = path.basename(filename, ext);
  if (LIB_EXTENSIONS.has(ext) && stem.startsWith("lib")) stem = stem.slice(3);
  if (kinds.includes("custom-build")) {
    const hash = path.basename(dir).slice(path.basename(dir).lastIndexOf("-") + 1);
    const found = readdirSync(dir).find((f) => f === `build_script_build-${hash}.d`);
    return found === undefined ? null : path.join(dir, found);
  }
  const candidate = path.join(dir, `${stem}.d`);
  return existsSync(candidate) ? candidate : null;
}

// The lines of a build script's output that name files it watches, and the env
// variables it watches. Cargo writes the script's "cargo:" lines to <out>/../output.
export function buildScriptWatches(outputText: string): { files: string[]; envs: string[] } {
  const files: string[] = [];
  const envs: string[] = [];
  for (const line of outputText.split("\n")) {
    const m = /^cargo::?(rerun-if-changed|rerun-if-env-changed)=(.*)$/.exec(line);
    if (m !== null) {
      (m[1] === "rerun-if-changed" ? files : envs).push((m[2] ?? "").trim());
    }
  }
  return { files, envs };
}
