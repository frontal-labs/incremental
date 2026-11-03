// Recorder preload (PLAN 11.2). Loaded into the test processes with
// NODE_OPTIONS=--import <this file>. The runner starts one Vitest process per
// test file, so every process with BACKPLANE_TRACE_OUT belongs to that task.
// Vitest does the module transforms in its main process and sends the code to
// the forked worker over IPC, so the main process must record too: that is how
// imported source files become inputs. Its directory listings are the test
// discovery glob, which is not an input of any task, so the main process does
// not record directories (see isTaskProcess below).
//
// Every observed access is appended to BACKPLANE_TRACE_OUT as one JSON line
// at the moment it happens (synchronously), so a crashing test keeps the
// reads it made before the crash (PLAN 11.6).
import fs from "node:fs";
import cp from "node:child_process";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wt from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import { EXCLUDED_DIRS, isTrackedEnv, sha256 } from "./shared.js";

type Kind = "read" | "stat" | "list";

const OUT = process.env.BACKPLANE_TRACE_OUT;
const RECORD = OUT !== undefined && OUT !== "";
// Worker processes and worker threads run the task's own code. Only they
// count directory listings and subprocesses as inputs of the task.
const isTaskProcess = typeof process.send === "function" || !wt.isMainThread;

if (RECORD) install(OUT as string);

// The baseline environment the main process recorded (env_base), or null.
function readBaseline(out: string, read: (file: string, enc: BufferEncoding) => string): Record<string, string> | null {
  try {
    for (const line of read(out, "utf8").split("\n")) {
      if (!line.includes("\"env_base\"")) continue;
      const e = JSON.parse(line) as { k?: string; s?: Record<string, string> };
      if (e.k === "env_base" && e.s !== undefined) return e.s;
    }
  } catch {
    // no trace yet: the caller falls back to its own environment
  }
  return null;
}

function install(out: string): void {
  // The original functions, kept so that the recorder's own I/O is not recorded.
  const realRealpath = fs.realpathSync;
  const realStat = fs.statSync;
  const realRead = fs.readFileSync;
  const realReadText = (file: string, enc: BufferEncoding): string => realRead(file, enc);
  const realAppend = fs.appendFileSync;

  const root = realRealpath(process.env.BACKPLANE_TRACE_ROOT ?? process.cwd());
  const tid = wt.threadId;
  const seen = new Set<string>();

  // True while the recorder itself does I/O. Node reads and appends files
  // through the public fs functions (readFileSync calls openSync), so without
  // this guard the recorder would record its own reads and recurse.
  let busy = false;

  function emit(key: string, rec: Record<string, unknown>): void {
    if (seen.has(key)) return;
    seen.add(key);
    const outer = busy;
    busy = true;
    try {
      realAppend(out, JSON.stringify({ ...rec, pid: process.pid, tid }) + "\n");
    } catch (err) {
      process.stderr.write(`backplane recorder: cannot write trace: ${String(err)}\n`);
    } finally {
      busy = outer;
    }
  }

  // Repo-relative canonical path (realpath, '/' separators), or null when the
  // path is outside the root or excluded (PLAN 11.4).
  function canonical(p: string): string | null {
    const abs = path.resolve(p);
    let real: string;
    try {
      real = realRealpath(abs);
    } catch {
      try {
        real = path.join(realRealpath(path.dirname(abs)), path.basename(abs));
      } catch {
        real = abs;
      }
    }
    const rel = path.relative(root, real);
    if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
    const parts = rel.split(path.sep);
    if (parts.some((s) => EXCLUDED_DIRS.includes(s))) return null;
    return parts.join("/");
  }

  function toPath(arg: unknown): string | undefined {
    if (typeof arg === "string") return arg;
    if (arg instanceof URL) {
      try {
        return fileURLToPath(arg);
      } catch {
        return undefined;
      }
    }
    if (Buffer.isBuffer(arg)) return arg.toString();
    return undefined; // file descriptors are covered by the open that made them
  }

  // Records what the access depends on: a regular file (with its content hash
  // at this moment), a listed directory, or a missing path (a probe).
  function noteAccess(arg: unknown, kind: Kind): void {
    const p = toPath(arg);
    if (p === undefined) return;
    const rel = canonical(p);
    if (rel === null) return;
    const abs = path.resolve(p);
    let isFile = false;
    let isDir = false;
    try {
      const st = realStat(abs);
      isFile = st.isFile();
      isDir = st.isDirectory();
    } catch {
      emit("p:" + rel, { k: "probe", p: rel });
      return;
    }
    if (isFile && kind !== "list" && !seen.has("f:" + rel)) {
      let hash: string;
      try {
        hash = sha256(realRead(abs));
      } catch {
        hash = "unreadable";
      }
      emit("f:" + rel, { k: "file", p: rel, h: hash });
    } else if (isDir && kind === "list" && isTaskProcess) {
      emit("d:" + rel, { k: "dir", p: rel });
    }
  }

  function isReadFlags(flags: unknown): boolean {
    if (flags === undefined || flags === null) return true;
    if (typeof flags === "number") {
      const writing = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;
      return (flags & writing) === 0 || (flags & fs.constants.O_RDWR) !== 0;
    }
    return typeof flags === "string" && flags.startsWith("r");
  }

  function patch(obj: object, name: string, kind: Kind | ((args: unknown[]) => Kind | null)): void {
    const target = obj as Record<string, unknown>;
    const orig = target[name];
    if (typeof orig !== "function") return;
    target[name] = function (this: unknown, ...args: unknown[]): unknown {
      const k = typeof kind === "function" ? kind(args) : kind;
      if (k !== null && !busy) {
        busy = true;
        try {
          noteAccess(args[0], k);
        } finally {
          busy = false;
        }
      }
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    };
    // Keep the properties of the original (fs.realpathSync.native is read by
    // Vite as a function, so a wrapper without it breaks module loading).
    for (const key of Reflect.ownKeys(orig)) {
      if (key === "length" || key === "name" || key === "prototype") continue;
      const desc = Object.getOwnPropertyDescriptor(orig, key);
      if (desc !== undefined) Object.defineProperty(target[name], key, desc);
    }
  }

  const openKind = (args: unknown[]): Kind | null => (isReadFlags(args[1]) ? "read" : null);
  for (const name of ["readFile", "readFileSync", "createReadStream"]) patch(fs, name, "read");
  for (const name of ["open", "openSync"]) patch(fs, name, openKind);
  for (const name of ["stat", "statSync", "lstat", "lstatSync", "access", "accessSync", "exists", "existsSync", "realpath", "realpathSync"]) {
    patch(fs, name, "stat");
  }
  for (const name of ["readdir", "readdirSync", "opendir", "opendirSync"]) patch(fs, name, "list");
  // Vite calls fs.realpathSync.native directly; record those calls too.
  patch(fs.realpathSync, "native", "stat");
  for (const name of ["readFile", "open"]) patch(fs.promises, name, name === "open" ? openKind : "read");
  for (const name of ["stat", "lstat", "access", "realpath"]) patch(fs.promises, name, "stat");
  patch(fs.promises, "readdir", "list");

  // Subprocesses are not observed. Their reads are not in the trace, so the
  // task is recorded as incomplete (PLAN 11.1 rule 4).
  const cpObj = cp as unknown as Record<string, unknown>;
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    const orig = cpObj[name];
    if (typeof orig !== "function") continue;
    cpObj[name] = function (this: unknown, ...args: unknown[]): unknown {
      if (isTaskProcess) emit("inc:sub", { k: "incomplete", why: "subprocess" });
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    };
  }

  // Module resolution by require() is done with native stat calls that are
  // not visible here. A require() from a repo file marks the task incomplete.
  const ModuleCls = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
  const origResolve = ModuleCls._resolveFilename;
  ModuleCls._resolveFilename = function (this: unknown, request: unknown, parent: unknown, ...rest: unknown[]): string {
    const from = (parent as { filename?: unknown } | undefined)?.filename;
    if (typeof from === "string" && canonical(from) !== null) emit("inc:cjs", { k: "incomplete", why: "cjs-resolution" });
    return origResolve.call(this, request, parent, ...rest);
  };

  // Worker threads: their reads are recorded through this same file. The task
  // is marked, so the runner records it dirty (PLAN 11.2, 11.1 rule 4).
  const OrigWorker = wt.Worker;
  class TracedWorker extends OrigWorker {
    constructor(filename: string | URL, options?: ConstructorParameters<typeof OrigWorker>[1]) {
      emit("worker", { k: "worker" });
      super(filename, options);
    }
  }
  (wt as unknown as { Worker: unknown }).Worker = TracedWorker;

  // Environment. The task is given the environment the runner built, and that
  // is the baseline the planner compares with. Vitest writes its own values
  // into process.env in the main process (MODE, DEV, TEST, ...), and workers
  // inherit them. So the baseline is the main process's environment before
  // Vitest wrote anything: the main process records it as env_base, and task
  // processes read it back from the shared trace. A name the process wrote
  // itself is not an input of the task.
  const origEnv = process.env;
  const initial: Record<string, string> = {};
  for (const name of Object.keys(origEnv)) {
    if (!isTrackedEnv(name)) continue;
    const value = origEnv[name];
    if (value !== undefined) initial[name] = sha256(value);
  }
  let baseline: Record<string, string> = initial;
  if (isTaskProcess) {
    const fromMain = readBaseline(out, realReadText);
    if (fromMain !== null) baseline = fromMain;
  } else {
    emit("env_base", { k: "env_base", s: initial });
  }
  process.env.BACKPLANE_RECORDER = "1";
  const written = new Set<string>();
  function noteEnv(name: string): void {
    if (!isTrackedEnv(name) || written.has(name)) return;
    emit("e:" + name, { k: "env", n: name, h: baseline[name] ?? "unset" });
  }
  process.env = new Proxy(origEnv, {
    get(target, key) {
      if (typeof key === "string") noteEnv(key);
      return Reflect.get(target, key);
    },
    has(target, key) {
      if (typeof key === "string") noteEnv(key);
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      // Only the task's own code counts. The main process enumerates the
      // environment to load configuration (Vite's loadEnv keeps the prefixed
      // names), and each name it actually reads is already an env input.
      if (isTaskProcess) emit("env_all", { k: "env_all", s: baseline });
      return Reflect.ownKeys(target);
    },
    set(target, key, value) {
      if (typeof key === "string") written.add(key);
      return Reflect.set(target, key, value);
    },
    deleteProperty(target, key) {
      if (typeof key === "string") written.add(key);
      return Reflect.deleteProperty(target, key);
    },
  });

  // ESM importers see patched builtins only after the live exports are synced.
  syncBuiltinESMExports();
}
