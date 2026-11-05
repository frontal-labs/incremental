// Unit tests for the strace log parser (PLAN §11.5). Synthetic strace output,
// so no strace binary or Linux is required: runs on every platform.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseStraceLog, type OracleResult, type StraceEvent } from "../src/oracle.js";

const O_EXCLUDED = ["node_modules", ".git", ".incremental"];

function line(pid: number, sys: string, args: string, result: string): string {
  return `${pid} ${sys}(${args}) = ${result}`;
}

function openRead(pid: number, p: string, fd: number): string {
  return line(pid, "openat", `AT_FDCWD, "${p}", O_RDONLY|O_CLOEXEC`, String(fd));
}

function openWrite(pid: number, p: string, fd: number): string {
  return line(pid, "open", `"${p}", O_WRONLY|O_CREAT|O_TRUNC`, String(fd));
}

function dirOpen(pid: number, p: string, fd: number): string {
  return line(pid, "openat", `AT_FDCWD, "${p}", O_RDONLY|O_DIRECTORY`, String(fd));
}

function okStat(pid: number, p: string): string {
  return line(pid, "stat", `"${p}", {st_mode=S_IFREG|0644, ...}`, "0");
}

function okStatDir(pid: number, p: string): string {
  return line(pid, "stat", `"${p}", {st_mode=S_IFDIR|0755, ...}`, "0");
}

// Real strace always passes a dirfd (AT_FDCWD or a number) to the *at
// syscalls; plain stat/open take the path directly.
const AT_SYSCALLS = new Set(["newfstatat", "statx", "faccessat", "faccessat2"]);

function fail(pid: number, sys: string, p: string, errno: string): string {
  const dirfd = AT_SYSCALLS.has(sys) ? "AT_FDCWD, " : "";
  return line(pid, sys, `${dirfd}"${p}", ...`, `-1 ${errno} (No such file or directory)`);
}

function getdents(pid: number, fd: number, ret: number): string {
  return line(pid, "getdents64", `${fd}, /* entries */, 32768`, String(ret));
}

function exec(pid: number, p: string): string {
  return line(pid, "execve", `"${p}", ["/usr/bin/node", "t.js"], [/* vars */]`, "0");
}

function readlinkat(pid: number, p: string): string {
  return line(pid, "readlinkat", `AT_FDCWD, "${p}", "target", 4096`, "6");
}

function summaryOf(lines: string[], root: string): OracleResult {
  return parseStraceLog(lines.join("\n"), { cwd: root, roots: [root] }).summary;
}

function eventsOf(lines: string[], root: string): StraceEvent[] {
  return parseStraceLog(lines.join("\n"), { cwd: root, roots: [root] }).events;
}

test("a successful read open of a regular file is a file input", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    const s = summaryOf([openRead(1, path.join(root, "a.ts"), 3)], root);
    assert.deepEqual(s.files, ["a.ts"]);
    assert.deepEqual(s.dirs, []);
    assert.deepEqual(s.probes, []);
    assert.deepEqual(s.execs, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a write open is not recorded", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    const s = summaryOf([openWrite(1, path.join(root, "a.ts"), 3)], root);
    assert.deepEqual(s.files, []);
    assert.deepEqual(s.dirs, []);
    assert.deepEqual(s.probes, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("O_RDWR counts as read intent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    const s = summaryOf(
      [line(1, "openat", `AT_FDCWD, "${path.join(root, "a.ts")}", O_RDWR`, "3")],
      root,
    );
    assert.deepEqual(s.files, ["a.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("O_PATH alone is not a read", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    const s = summaryOf(
      [line(1, "open", `"${path.join(root, "a.ts")}", O_PATH|O_DIRECTORY`, "3")],
      root,
    );
    assert.deepEqual(s.files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a successful stat of a file is a file input; a successful stat of a dir is not", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    mkdirSync(path.join(root, "sub"));
    const s = summaryOf(
      [okStat(1, path.join(root, "a.ts")), okStatDir(1, path.join(root, "sub"))],
      root,
    );
    assert.deepEqual(s.files, ["a.ts"]);
    assert.deepEqual(s.dirs, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stat and open failures are probes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    mkdirSync(path.join(root, "src"));
    const gone = path.join(root, "src", "gone.txt");
    const s = summaryOf(
      [
        fail(1, "stat", gone, "ENOENT"),
        fail(1, "openat", gone, "ENOENT"),
        fail(1, "access", gone, "ENOENT"),
        fail(1, "newfstatat", gone, "ENOENT"),
      ],
      root,
    );
    assert.deepEqual(s.probes, ["src/gone.txt"]);
    assert.deepEqual(s.files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("access success on a file is a file input", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "acc.txt"), "x");
    const s = summaryOf([line(1, "access", `"${path.join(root, "acc.txt")}", R_OK`, "0")], root);
    assert.deepEqual(s.files, ["acc.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("statx success reports the file; newfstatat failure reports a probe", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "sx.txt"), "x");
    const gone = path.join(root, "nf.txt");
    mkdirSync(path.join(root, "src"));
    const s = summaryOf(
      [
        line(
          1,
          "statx",
          `AT_FDCWD, "${path.join(root, "sx.txt")}", 0, STATX_SIZE, {st_mode=...}`,
          "0",
        ),
        fail(1, "newfstatat", path.join(root, "src", "missing.txt"), "ENOENT"),
      ],
      root,
    );
    assert.deepEqual(s.files, ["sx.txt"]);
    assert.deepEqual(s.probes, ["src/missing.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("faccessat failure is a probe", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    const s = summaryOf([fail(1, "faccessat", path.join(root, "fa.txt"), "ENOENT")], root);
    assert.deepEqual(s.probes, ["fa.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getdents64 on a directory fd reports the dir", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    mkdirSync(path.join(root, "plugins"));
    const s = summaryOf(
      [dirOpen(1, path.join(root, "plugins"), 5), getdents(1, 5, 96), getdents(1, 5, 0)],
      root,
    );
    assert.deepEqual(s.dirs, ["plugins"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getdents64 on an unknown or failed fd reports nothing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    const s = summaryOf(
      [
        getdents(1, 99, 96),
        line(1, "getdents64", `5, /* entries */, 32768`, "-1 EBADF (Bad file descriptor)"),
      ],
      root,
    );
    assert.deepEqual(s.dirs, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("execve reports the executed program", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    const s = summaryOf([exec(1, "/usr/bin/node")], root);
    assert.deepEqual(s.execs, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an execve under the root is reported as exec", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "tool.sh"), "#!/bin/sh");
    const s = summaryOf([exec(1, path.join(root, "tool.sh"))], root);
    assert.deepEqual(s.execs, ["tool.sh"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readlink and readlinkat are not reported", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    const ev = eventsOf(
      [openRead(1, path.join(root, "a.ts"), 3), readlinkat(1, path.join(root, "a.ts"))],
      root,
    );
    assert.deepEqual(
      ev.map((e) => [e.kind, e.path]),
      [["file", "a.ts"]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("paths are resolved against the cwd for relative tracer paths", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "rel.txt"), "x");
    const s = summaryOf([openRead(1, "rel.txt", 3)], root);
    assert.deepEqual(s.files, ["rel.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing paths probe through the realpath fallback", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    mkdirSync(path.join(root, "src"));
    const s = summaryOf([fail(1, "stat", path.join(root, "src", "missing.txt"), "ENOENT")], root);
    assert.deepEqual(s.probes, ["src/missing.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("excluded directory parts are dropped", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    mkdirSync(path.join(root, ".git"), { recursive: true });
    mkdirSync(path.join(root, ".incremental"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "x");
    writeFileSync(path.join(root, ".git", "config"), "x");
    writeFileSync(path.join(root, ".incremental", "log"), "x");
    writeFileSync(path.join(root, "keep.ts"), "x");
    const s = summaryOf(
      [
        openRead(1, path.join(root, "node_modules", "pkg", "index.js"), 3),
        openRead(1, path.join(root, ".git", "config"), 4),
        openRead(1, path.join(root, ".incremental", "log"), 5),
        openRead(1, path.join(root, "keep.ts"), 6),
      ],
      root,
    );
    assert.deepEqual(s.files, ["keep.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("paths outside the roots are dropped", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "in.ts"), "x");
    const outside = path.join(os.tmpdir(), "bp-strace-outside.txt");
    writeFileSync(outside, "x");
    const s = summaryOf([openRead(1, path.join(root, "in.ts"), 3), openRead(1, outside, 4)], root);
    assert.deepEqual(s.files, ["in.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("multiple processes are deduped (-f)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    mkdirSync(path.join(root, "sub"), { recursive: true });
    const s = summaryOf(
      [
        openRead(10, path.join(root, "a.ts"), 3),
        openRead(20, path.join(root, "a.ts"), 7),
        dirOpen(10, path.join(root, "sub"), 4),
        getdents(10, 4, 32),
      ],
      root,
    );
    assert.deepEqual(s.files, ["a.ts"]);
    assert.deepEqual(s.dirs, ["sub"]);
    assert.deepEqual(s.probes, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a non-strace line is ignored", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    const s = summaryOf(
      [
        "strace: Process 123 attached",
        "123 --- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_status=0} ---",
        "123 <... stat resumed>",
        openRead(1, path.join(root, "a.ts"), 3),
      ],
      root,
    );
    assert.deepEqual(s.files, ["a.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("events keep their pid for caller-side filtering", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bp-strace-"));
  try {
    writeFileSync(path.join(root, "a.ts"), "x");
    mkdirSync(path.join(root, "sub"), { recursive: true });
    const ev = eventsOf(
      [
        openRead(1, path.join(root, "a.ts"), 3),
        fail(2, "openat", path.join(root, "b.ts"), "ENOENT"),
      ],
      root,
    );
    assert.deepEqual(
      ev.map((e) => [e.kind, e.path, e.pid]),
      [
        ["file", "a.ts", 1],
        ["probe", "b.ts", 2],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
