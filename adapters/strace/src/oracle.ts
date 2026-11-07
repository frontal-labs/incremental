// @incremental/strace: native strace oracle (PLAN §11.5, E5). Linux only.
//
// `runOracle` runs a command under
//
//   strace -f -e trace=openat,open,openat2,stat,newfstatat,statx,access,faccessat,faccessat2,getdents64,readlink,readlinkat,execve -o <file> -- <cmd>
//
// and reports what the command touched under the configured roots:
//
//   files   regular files opened or stat'ed for reading
//   dirs    directories read with getdents64
//   probes  path lookups that failed (ENOENT or otherwise)
//   execs   programs executed with execve
//
// Paths are realpath'd, confined to `roots`, and returned repo-relative with
// "/" separators, exactly like the Vitest recorder canonicalizes them
// (PLAN 11.4). strace cannot see environment reads (PLAN 11.5).
//
// The Node recorder must contain every path this oracle sees (after exclude
// and realpath); any gap is a recorder bug and can never be waived (PLAN 11.5).
//
// `parseStraceLog` takes strace output as text and starts no process, so it can
// be tested on any platform. `runOracle` itself requires Linux (strace) and
// throws `StraceUnavailableError` elsewhere.

import { spawn } from "node:child_process";
import { readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Directories that are never recorded or discovered (PLAN 6.7 default exclude).
export const EXCLUDED_DIRS: readonly string[] = ["node_modules", ".git", ".incremental"];

// The syscall set from PLAN §11.5.
export const STRACE_TRACE =
  "openat,open,openat2,stat,newfstatat,statx,access,faccessat,faccessat2,getdents64,readlink,readlinkat,execve";

export interface OracleResult {
  files: string[]; // repo-relative, sorted, unique
  dirs: string[];
  probes: string[];
  execs: string[];
}

export interface StraceEvent {
  kind: "file" | "dir" | "probe" | "exec";
  path: string; // repo-relative, canonicalized
  pid: number;
}

export interface ParseOptions {
  // Absolute cwd the traced command ran in; relative tracer paths resolve here.
  cwd: string;
  // Absolute repo roots. A reported path must live under one of them.
  roots: string[];
}

export interface ParsedLog {
  events: StraceEvent[];
  summary: OracleResult;
}

export interface RunOptions extends ParseOptions {
  timeoutMs?: number; // default 120 000 ms
  env?: NodeJS.ProcessEnv;
}

export class StraceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StraceUnavailableError";
  }
}

interface FdInfo {
  real: string; // realpath of what the fd refers to
  isDir: boolean;
}

interface Resolved {
  rel: string | null;
  real: string;
}

// Canonicalize one path the tracer saw: realpath, then repo-relative under one
// of `roots`, with excluded directory parts dropped. Mirrors the Vitest
// preload's canonical (adapters/vitest/src/preload.ts), PLAN 11.4. The cwd and
// the roots are realpath'd first, so symlinked temp directories (common on
// macOS) match the realpath'd paths the tracer sees.
function realpathDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

function resolvePath(p: string, ctx: ParseOptions): Resolved {
  const realCwd = realpathDir(ctx.cwd);
  const abs = path.resolve(realCwd, p);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    try {
      // The path does not exist (a probe): the recorder falls back to
      // realpath(dirname) + basename, so do the same.
      real = path.join(realpathDir(path.dirname(abs)), path.basename(abs));
    } catch {
      real = abs;
    }
  }
  let root = "";
  let matched = false;
  for (let k = 0; !matched && k < ctx.roots.length; k++) {
    const realRoot = realpathDir(ctx.roots[k] as string);
    const under = path.relative(realRoot, real);
    if (!(under === "" || under.startsWith("..") || path.isAbsolute(under))) {
      root = realRoot;
      matched = true;
    }
  }
  if (root === "") return { rel: null, real };
  const rel = path.relative(root, real);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return { rel: null, real };
  const parts = rel.split(path.sep);
  if (parts.some((s) => EXCLUDED_DIRS.includes(s))) return { rel: null, real };
  return { rel: parts.join("/"), real };
}

const typeCache = new Map<string, "file" | "dir" | null>();

// The file/dir type of a realpath'd path, cached. Missing paths are null.
function nodeType(real: string): "file" | "dir" | null {
  let cached = typeCache.get(real);
  if (cached === undefined) {
    try {
      const st = statSync(real);
      cached = st.isFile() ? "file" : st.isDirectory() ? "dir" : null;
    } catch {
      cached = null;
    }
    typeCache.set(real, cached);
  }
  return cached;
}

// True when the open flags show read intent, matching the recorder's
// `isReadFlags` (adapters/vitest/src/preload.ts): unknown flags count as a
// read, O_WRONLY without O_RDWR does not, O_PATH/O_SEARCH alone do not.
function readIntent(flags: string | undefined): boolean {
  const tokens: string[] = flags === undefined ? [] : (flags.match(/O_[A-Z]+/g) ?? []);
  if (tokens.includes("O_RDONLY") || tokens.includes("O_RDWR")) return true;
  if (tokens.includes("O_WRONLY")) return false;
  if (tokens.includes("O_PATH") || tokens.includes("O_SEARCH")) return false;
  return true;
}

interface ParsedResult {
  ok: boolean;
  fd?: number;
  errno?: string;
}

function parseResult(tail: string): ParsedResult {
  const m = /^(\d+)/.exec(tail);
  if (m) return { ok: true, fd: Number(m[1]) };
  const m2 = /^-1\s+([A-Z0-9]+)/.exec(tail);
  if (m2) return { ok: false, errno: m2[1] };
  return { ok: false };
}

// Find `sep` outside of double-quoted strings (strace escapes `"` as `\"`).
function findUnquoted(line: string, sep: string, from: number): number {
  let inQuote = false;
  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++; // skip the escaped character
    } else {
      if (ch === '"') inQuote = !inQuote;
      if (!inQuote && line.startsWith(sep, i)) return i;
    }
  }
  return -1;
}

// The contents of the first double-quoted string in `text`, unescaped.
//
// strace escapes non-printable bytes in paths as octal (\NNN) or hex (\xNN)
// escapes. Those stand for raw bytes and are never part of a clean repository
// path, so such a string is rejected rather than mangled into garbage digits.
// Only the escapes strace emits for printable-relevant characters are unescaped.
function firstQuoted(text: string): string | null {
  const m = /"(?:[^"\\]|\\.)*"/.exec(text);
  if (m === null) return null;
  const raw = m[0].slice(1, -1);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== undefined) {
      if (ch === "\\") {
        const n = raw[i + 1];
        if (n === undefined) return null; // trailing backslash: not a clean path
        if (n === '"') {
          out.push('"');
        } else if (n === "\\") {
          out.push("\\");
        } else if (n === "n") {
          out.push("\n");
        } else if (n === "t") {
          out.push("\t");
        } else if (n === "r") {
          out.push("\r");
        } else if (n === "a") {
          out.push("\u0007");
        } else if (n === "b") {
          out.push("\b");
        } else if (n === "v") {
          out.push("\v");
        } else if (n === "f") {
          out.push("\f");
        } else {
          // Octal (\NNN), hex (\xNN) or any other escape: raw bytes, not a path.
          return null;
        }
        i++; // skip the escaped character
      } else {
        out.push(ch);
      }
    }
  }
  const s = out.join("");
  // A real repository path is printable; reject anything else.
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  return s;
}

// The open flags: from an openat2 `{flags=...}` how-structure, or the last
// top-level comma segment of an open/openat argument list.
function flagsOf(args: string): string | undefined {
  const brace = args.indexOf("{flags=");
  if (brace !== -1) {
    const start = brace + "{flags=".length;
    let end = args.length;
    const c = args.indexOf(",", start);
    const b = args.indexOf("}", start);
    if (c !== -1 && c < end) end = c;
    if (b !== -1 && b < end) end = b;
    return args.slice(start, end).trim() || undefined;
  }
  let cut = -1;
  let inQuote = false;
  for (let i = args.length - 1; cut === -1 && i >= 0; i--) {
    const ch = args[i];
    if (ch === "\\") {
      i--;
    } else {
      if (ch === '"') inQuote = !inQuote;
      if (!inQuote && ch === ",") {
        cut = i;
      }
    }
  }
  const seg = cut === -1 ? args : args.slice(cut + 1);
  return seg.replace(/\)+\s*$/, "").trim() || undefined;
}

// The first top-level comma segment, trimmed ("AT_FDCWD" or a fd number).
function firstSegment(args: string): string {
  let cut = -1;
  let inQuote = false;
  for (let i = 0; cut === -1 && i < args.length; i++) {
    const ch = args[i];
    if (ch === "\\") {
      i++;
    } else {
      if (ch === '"') inQuote = !inQuote;
      if (!inQuote && ch === ",") {
        cut = i;
      }
    }
  }
  return cut === -1 ? args.trim() : args.slice(0, cut).trim();
}

// The first numeric fd mentioned in the argument list.
function firstFd(args: string): number | undefined {
  const m = /\b(\d+)\b/.exec(args);
  return m === null ? undefined : Number(m[1]);
}

export function parseStraceLog(text: string, opts: ParseOptions): ParsedLog {
  const events: StraceEvent[] = [];
  // pid -> fd -> what the fd refers to (populated from successful opens).
  const fds = new Map<number, Map<number, FdInfo>>();

  const add = (kind: StraceEvent["kind"], pid: number, p: string): void => {
    const resolved = resolvePath(p, opts);
    if (resolved.rel === null) return;
    events.push({ kind, path: resolved.rel, pid });
  };

  // A stat-family result. Failure is a probe (the recorder treats any stat
  // error as a probe). Success reports a regular file; directories are
  // reported via getdents64, never via stat.
  const statResult = (pid: number, p: string, ok: boolean): void => {
    if (!ok) {
      add("probe", pid, p);
      return;
    }
    const resolved = resolvePath(p, opts);
    if (resolved.rel === null || nodeType(resolved.real) !== "file") return;
    add("file", pid, p);
  };

  // Remember what an opened fd refers to, so getdents64 can be attributed.
  const trackFd = (pid: number, fd: number | undefined, p: string): void => {
    if (fd === undefined) return;
    const resolved = resolvePath(p, opts);
    let byPid = fds.get(pid);
    if (byPid === undefined) {
      byPid = new Map();
      fds.set(pid, byPid);
    }
    byPid.set(fd, { real: resolved.real, isDir: nodeType(resolved.real) === "dir" });
  };

  const statLike = new Set([
    "stat",
    "lstat",
    "newfstatat",
    "statx",
    "access",
    "faccessat",
    "faccessat2",
  ]);
  const openLike = new Set(["open", "openat", "openat2"]);

  // A syscall that strace split across an `<unfinished ...>` line and a later
  // `<... syscall resumed>) = result` line. Stored per pid until resumed.
  const pending = new Map<number, { sys: string; args: string }>();

  // Handles one complete syscall invocation: `sys(args) = result`.
  const handle = (pid: number, sys: string, args: string, result: ParsedResult): void => {
    if (openLike.has(sys)) {
      const p = firstQuoted(args);
      if (p === null) return;
      if (result.ok) {
        const resolved = resolvePath(p, opts);
        if (result.fd !== undefined) trackFd(pid, result.fd, p);
        if (
          resolved.rel !== null &&
          nodeType(resolved.real) === "file" &&
          readIntent(flagsOf(args))
        ) {
          add("file", pid, p);
        }
      } else {
        add("probe", pid, p);
      }
      return;
    }

    if (sys === "getdents64") {
      const fd = firstFd(args);
      if (fd === undefined) return;
      const info = fds.get(pid)?.get(fd);
      // A successful directory read is a dir input of the task.
      if (
        info !== undefined &&
        info.isDir &&
        result.ok &&
        (result.fd === undefined || result.fd >= 0)
      ) {
        add("dir", pid, info.real);
      }
      return;
    }

    if (sys === "execve") {
      if (result.ok) {
        const p = firstQuoted(args);
        if (p !== null) add("exec", pid, p);
      }
      return;
    }

    if (sys === "readlink" || sys === "readlinkat") {
      // Symlink resolution is not an input of the task; realpath probes are
      // reported through the resolvePath fallback above.
      return;
    }

    if (statLike.has(sys)) {
      let p: string | null = null;
      if (sys === "statx" || sys === "newfstatat" || sys === "faccessat" || sys === "faccessat2") {
        const dirfd = firstSegment(args);
        if (dirfd === "AT_FDCWD") {
          p = firstQuoted(args);
        } else {
          const fd = Number(dirfd);
          const base = fds.get(pid)?.get(fd)?.real;
          const rel = firstQuoted(args);
          if (base !== undefined && rel !== null) {
            p = path.isAbsolute(rel) ? rel : path.join(base, rel);
          }
        }
      } else {
        p = firstQuoted(args);
      }
      if (p !== null) statResult(pid, p, result.ok);
      return;
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const m = /^\s*(\d+)\s+([a-z_][a-z0-9_]*)\(/.exec(line);
    if (m !== null) {
      const pid = Number(m[1] ?? "");
      const sys = m[2] ?? "";
      // An unfinished syscall: `pid sys(args) <unfinished ...>`. Remember its
      // args and wait for the matching `<... sys resumed>) = result` line.
      if (line.includes("<unfinished")) {
        const unfinished = line.indexOf("<unfinished");
        const args = line.slice(m[0].length, unfinished).replace(/\)\s*$/, "");
        pending.set(pid, { sys, args });
      } else {
        // A complete syscall line: `pid sys(args) = result`.
        const sep = findUnquoted(line, " = ", m[0].length);
        if (sep !== -1) {
          const args = line.slice(m[0].length, sep).replace(/\)\s*$/, "");
          const result = parseResult(line.slice(sep + 3));
          handle(pid, sys, args, result);
        }
      }
    } else {
      // A resumed syscall line: `pid <... sys resumed>) = result`.
      const resumed = /^\s*(\d+)\s+<\.{3}\s+([a-z_][a-z0-9_]*)\s+resumed>\)\s*=\s*(.*)$/.exec(line);
      if (resumed !== null) {
        const pid = Number(resumed[1] ?? "");
        const sys = resumed[2] ?? "";
        const pend = pending.get(pid);
        if (pend !== undefined && pend.sys === sys) {
          pending.delete(pid);
          handle(pid, sys, pend.args, parseResult(resumed[3] ?? ""));
        }
      }
    }
  }

  const summary: OracleResult = { files: [], dirs: [], probes: [], execs: [] };
  const seen = new Set<string>();
  const kindToKey: Record<StraceEvent["kind"], keyof OracleResult> = {
    file: "files",
    dir: "dirs",
    probe: "probes",
    exec: "execs",
  };
  for (const e of events) {
    const key = e.kind + "\0" + e.path;
    if (!seen.has(key)) {
      seen.add(key);
      const bucket = summary[kindToKey[e.kind]];
      if (bucket !== undefined) bucket.push(e.path);
    }
  }
  for (const kind of Object.keys(summary) as Array<keyof OracleResult>) {
    summary[kind].sort();
  }
  return { events, summary };
}

export async function runOracle(
  command: string[],
  opts: RunOptions,
): Promise<{ log: string; events: StraceEvent[]; summary: OracleResult }> {
  if (process.platform !== "linux") {
    throw new StraceUnavailableError(
      "the strace oracle is Linux-only; strace is not available on this platform",
    );
  }
  const log = path.join(os.tmpdir(), `incremental-strace-${process.pid}-${Date.now()}.log`);
  const child = spawn(
    "strace",
    ["-f", "-e", `trace=${STRACE_TRACE}`, "-o", log, "--", ...command],
    {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
    },
  );
  return new Promise<{ log: string; events: StraceEvent[]; summary: OracleResult }>(
    (resolve, reject) => {
      let finished = false;
      const fail = (err: unknown): void => {
        if (finished) return;
        finished = true;
        reject(err);
      };
      child.on("error", (err) =>
        fail(
          new StraceUnavailableError(
            `cannot run strace: ${(err as NodeJS.ErrnoException).message} (is strace installed?)`,
          ),
        ),
      );
      child.on("close", () => {
        if (finished) return;
        finished = true;
        let text = "";
        try {
          text = readFileSync(log, "utf8");
        } catch {
          // no log: nothing was traced
        }
        try {
          rmSync(log, { force: true });
        } catch {
          // the temp log is best effort
        }
        let parsed: ParsedLog;
        try {
          parsed = parseStraceLog(text, { cwd: opts.cwd, roots: opts.roots });
        } catch (err) {
          fail(err);
          return;
        }
        resolve({ log, events: parsed.events, summary: parsed.summary });
      });
      const timeoutMs = opts.timeoutMs ?? 120_000;
      const timer = setTimeout(() => {
        try {
          // strace is the process group leader (detached): kill the group so the
          // traced command and its children stop too.
          const pid = child.pid;
          if (pid !== undefined) process.kill(-pid, "SIGTERM");
        } catch {
          // best effort
        }
      }, timeoutMs);
      timer.unref();
    },
  );
}
