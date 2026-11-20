// @ts-check
/**
 * Registry sync.
 *
 * Mirrors the design-system registry (`registry.config`) into the workspace:
 * fetches the catalogue + items with etag caching, rewrites
 * `@/registry/default/*` specifiers to the configured specifier, writes
 * managed files, prunes files the lock no longer owns, maintains
 * `ui.lock.json`, and reports dependency/theme drift.
 *
 * Safety is preserved at runtime (no silent narrowing):
 * - unknown CLI args throw (exit 2 via main guard)
 * - unexpandable/unknown registry refs, collisions, missing file content,
 *   `target`-set files, and unrewritten specifiers all throw
 * - only files listed in the previous lock are ever pruned; hand-written
 *   files that share a managed directory are left alone
 * - `--check` exits 1 on drift; locally modified files are skipped unless
 *   `--force`; blocked writes keep old lock entries
 *
 * Run with `bun scripts/sync-registry.js [--check|--dry-run|--force|--install|--only a,b]`.
 * Pure helpers are exported for `tests/sync.test.ts`.
 * @module sync-registry
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import config from "../registry.config";

/**
 * @typedef {import("../registry.config").SyncConfig} SyncConfig
 *
 * @typedef {object} IndexItem
 * @property {unknown[]} [files]
 * @property {string} name
 * @property {string[]} [registryDependencies]
 * @property {string} type
 *
 * @typedef {object} RegistryFile
 * @property {string} [content]
 * @property {string} path
 * @property {string|null} [target]
 * @property {string} type
 *
 * @typedef {object} RegistryItem
 * @property {Record<string, unknown>} [css]
 * @property {Record<string, Record<string, string>>} [cssVars]
 * @property {string[]} [dependencies]
 * @property {string[]} [devDependencies]
 * @property {RegistryFile[]} files
 * @property {string} name
 * @property {string[]} [registryDependencies]
 * @property {string} type
 *
 * @typedef {object} Catalogue
 * @property {IndexItem[]} items
 *
 * @typedef {object} LockFileEntry
 * @property {string} path
 * @property {string} registryPath
 * @property {string} sha256
 * @property {string} sourceSha256
 *
 * @typedef {object} LockItem
 * @property {Record<string, unknown>} [css]
 * @property {Record<string, Record<string, string>>} [cssVars]
 * @property {string[]} dependencies
 * @property {string} [etag]
 * @property {LockFileEntry[]} files
 * @property {string[]} registryDependencies
 * @property {string} type
 *
 * @typedef {object} LockFile
 * @property {Record<string, string[]>} assets
 * @property {string} generatedAt
 * @property {Record<string, LockItem>} items
 * @property {Record<string, string[]>} packages
 * @property {string} registry
 * @property {string} [registryEtag]
 * @property {1} version
 *
 * @typedef {object} Flags
 * @property {boolean} check
 * @property {boolean} dryRun
 * @property {boolean} force
 * @property {boolean} install
 * @property {string[]} [only]
 *
 * @typedef {object} PreparedFile
 * @property {string} code
 * @property {string} item
 * @property {string} path
 * @property {string} registryPath
 * @property {string} sha256
 * @property {string} sourceSha256
 *
 * @typedef {object} Plan
 * @property {string[]} added
 * @property {string[]} localMods
 * @property {string[]} prunes
 * @property {string[]} removed
 * @property {string[]} unchanged
 * @property {string[]} updated
 * @property {PreparedFile[]} writes
 *
 * @typedef {object} Prepared
 * @property {Map<string, Set<string>>} assets
 * @property {Record<string, LockItem>} lockItems
 * @property {Map<string, Set<string>>} packages
 * @property {PreparedFile[]} prepared
 *
 * @typedef {object} PackageJson
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [devDependencies]
 * @property {Record<string, string>} [peerDependencies]
 *
 * @typedef {object} FetchedItem
 * @property {string} [etag]
 * @property {RegistryItem} item
 *
 * @typedef {object} DependencyDiff
 * @property {string[]} extraneous
 * @property {string[]} missing
 *
 * @typedef {"added"|"updated"|"unchanged"} ItemStatus
 */

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const LOCK_PATH = path.join(ROOT, "ui.lock.json");
const CACHE_DIR = path.join(ROOT, "node_modules/.cache/ui-sync");
const STYLES_DIR = path.join(ROOT, "src/styles");
const REGISTRY_PREFIX = "registry/default/";
const REGISTRY_ALIAS = "@/registry/default/";
const LEAK_MARKERS = [
  "@/registry/",
  "@incremental-labs/ui/",
  "@incremental-labs/design-system/",
];
const IGNORED_TYPES = new Set(["registry:style", "registry:font"]);
const BOOLEAN_FLAGS = new Set(["--check", "--dry-run", "--force", "--install"]);
const THEME_SCOPES = ["light", "dark", "theme"];
const CODE_EXT_RE = /\.(tsx?|jsx?)$/;
const SRC_PREFIX_RE = /^src\//;
const ASSET_RE = /\.(css|scss|sass|less)$/;
const PACKAGE_NAME_RE = /^(@[^/]+\/[^/@]+|[^/@]+)/;
const QUOTED_REGISTRY_RE = /(["'])(@\/registry\/[^"']+)\1/g;
const LEADING_DASHES_RE = /^--/;
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * @param {unknown} error
 * @returns {boolean}
 */
const isEnoent = (error) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

/**
 * @param {string} value
 * @returns {string[]}
 */
const splitList = (value) => value.split(",").filter(Boolean);

/**
 * @param {string[]} argv
 * @returns {Flags}
 */
export function parseArgs(argv) {
  /** @type {Set<string>} */
  const switches = new Set();
  /** @type {string[]|undefined} */
  let only;
  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg !== undefined && BOOLEAN_FLAGS.has(arg)) {
      switches.add(arg);
    } else if (arg === "--only") {
      only = splitList(rest.shift() ?? "");
    } else if (typeof arg === "string" && arg.startsWith("--only=")) {
      only = splitList(arg.slice("--only=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    check: switches.has("--check"),
    dryRun: switches.has("--dry-run"),
    force: switches.has("--force"),
    install: switches.has("--install"),
    ...(only ? { only } : {}),
  };
}

/**
 * @param {string} text
 * @returns {string}
 */
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortDeep(record[key])])
    );
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stableJson(value) {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

/**
 * @param {string} dep
 * @param {SyncConfig} cfg
 * @returns {string}
 */
export function normalizeRegistryDep(dep, cfg) {
  const prefix = `${cfg.namespace}/`;
  if (dep.startsWith(prefix)) {
    return dep.slice(prefix.length);
  }
  if (cfg.ambientRegistry.includes(dep)) {
    return dep;
  }
  throw new Error(
    `Unsupported registry dependency "${dep}": expected "${cfg.namespace}/<name>" or one of ${JSON.stringify(cfg.ambientRegistry)}`
  );
}

/**
 * @param {IndexItem[]} index
 * @param {SyncConfig} cfg
 * @param {string[]} [only]
 * @returns {string[]}
 */
export function selectRoots(index, cfg, only) {
  const excluded = new Set([...cfg.skip, ...cfg.ambientRegistry]);
  const roots = index
    .filter(
      (item) =>
        (cfg.include.types.includes(item.type) ||
          cfg.extra.includes(item.name)) &&
        !excluded.has(item.name) &&
        (item.files?.length ?? 0) > 0
    )
    .map((item) => item.name);
  if (only) {
    const missing = only.filter((name) => !roots.includes(name));
    if (missing.length > 0) {
      throw new Error(`--only names not selectable: ${missing.join(", ")}`);
    }
    return only;
  }
  return roots.sort();
}

/**
 * @param {string[]} roots
 * @param {Map<string, IndexItem>} index
 * @param {SyncConfig} cfg
 * @returns {{ names: string[], notes: string[] }}
 */
export function resolveClosure(roots, index, cfg) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const notes = [];
  const skip = new Set(cfg.skip);
  const queue = [...roots];
  /**
   * @param {string} from
   * @param {string} dep
   * @returns {void}
   */
  const visitDependency = (from, dep) => {
    const target = index.get(dep);
    if (!target) {
      throw new Error(`"${from}" depends on unknown registry item "${dep}"`);
    }
    if (skip.has(dep)) {
      notes.push(`"${from}" depends on skipped item "${dep}"`);
      return;
    }
    if (IGNORED_TYPES.has(target.type)) {
      notes.push(`"${from}" depends on ${target.type} "${dep}" (not mirrored)`);
      return;
    }
    queue.push(dep);
  };
  /**
   * @param {string} name
   * @returns {void}
   */
  const visit = (name) => {
    const item = index.get(name);
    if (!item) {
      throw new Error(`Registry item "${name}" not found in index`);
    }
    seen.add(name);
    const deps = (item.registryDependencies ?? [])
      .map((raw) => normalizeRegistryDep(raw, cfg))
      .filter((dep) => !(seen.has(dep) || cfg.ambientRegistry.includes(dep)));
    for (const dep of deps) {
      visitDependency(name, dep);
    }
  };
  while (queue.length > 0) {
    const name = queue.shift();
    if (name !== undefined && !seen.has(name)) {
      visit(name);
    }
  }
  return { names: [...seen].sort(), notes };
}

/**
 * @param {string} registryPath
 * @param {SyncConfig} cfg
 * @returns {{ ns: string, dir: string, file: string, packagePath: string }}
 */
export function mapRegistryPath(registryPath, cfg) {
  if (!registryPath.startsWith(REGISTRY_PREFIX)) {
    throw new Error(`Unexpected registry path "${registryPath}"`);
  }
  const rest = registryPath.slice(REGISTRY_PREFIX.length);
  const slash = rest.indexOf("/");
  const ns = slash === -1 ? "" : rest.slice(0, slash);
  const file = rest.slice(slash + 1);
  const dir = cfg.paths[ns];
  if (!dir || file.includes("/")) {
    throw new Error(`No path mapping for registry path "${registryPath}"`);
  }
  return { dir, file, ns, packagePath: path.posix.join(dir, file) };
}

/**
 * @param {string} code
 * @returns {string[]}
 */
export function parseImports(code) {
  return [...code.matchAll(IMPORT_RE)]
    .map((m) => m[1] ?? m[2])
    .filter((spec) => typeof spec === "string");
}

/**
 * @param {string} specifier
 * @param {SyncConfig} cfg
 * @returns {string}
 */
export function rewriteSpecifier(specifier, cfg) {
  const { dir, file } = mapRegistryPath(
    REGISTRY_PREFIX + specifier.slice(REGISTRY_ALIAS.length),
    cfg
  );
  const bare = file.replace(CODE_EXT_RE, "");
  const subpath = dir.replace(SRC_PREFIX_RE, "");
  return `${cfg.specifier}/${subpath}/${bare}`;
}

/**
 * @param {string} spec
 * @param {SyncConfig} cfg
 * @returns {boolean}
 */
const isLocalSpecifier = (spec, cfg) =>
  spec.startsWith(".") ||
  spec.startsWith("@/") ||
  spec.startsWith(`${cfg.specifier}/`) ||
  spec.startsWith("node:");

/**
 * @param {string} code
 * @param {SyncConfig} cfg
 * @returns {{ code: string, registryRefs: string[], externals: string[] }}
 */
export function rewriteImports(code, cfg) {
  /** @type {Set<string>} */
  const registryRefs = new Set();
  /** @type {Set<string>} */
  const externals = new Set();
  for (const spec of parseImports(code)) {
    if (spec.startsWith(REGISTRY_ALIAS)) {
      registryRefs.add(
        spec
          .slice(REGISTRY_ALIAS.length)
          .split("/")
          .slice(1)
          .join("/")
          .replace(CODE_EXT_RE, "")
      );
    } else if (spec.startsWith("@/registry/")) {
      throw new Error(`Unknown registry alias in import: "${spec}"`);
    } else if (!isLocalSpecifier(spec, cfg)) {
      externals.add(spec);
    }
  }
  const rewritten = code.replace(
    QUOTED_REGISTRY_RE,
    (_match, /** @type {string} */ quote, /** @type {string} */ spec) =>
      `${quote}${rewriteSpecifier(spec, cfg)}${quote}`
  );
  return {
    code: rewritten,
    externals: [...externals].sort(),
    registryRefs: [...registryRefs].sort(),
  };
}

/**
 * @param {string} specifier
 * @returns {{ pkg: string, asset: boolean }}
 */
export function packageNameOf(specifier) {
  const match = PACKAGE_NAME_RE.exec(specifier);
  return {
    asset: ASSET_RE.test(specifier),
    pkg: match?.[1] ?? specifier,
  };
}

/**
 * @param {string} relPath
 * @param {string[]} keep
 * @returns {boolean}
 */
export function matchesKeep(relPath, keep) {
  const base = path.posix.basename(relPath);
  return keep.some((pattern) => {
    if (pattern.startsWith("**/")) {
      const suffix = pattern.slice(3);
      if (suffix.startsWith("*")) {
        return base.endsWith(suffix.slice(1));
      }
      return relPath.endsWith(suffix);
    }
    return base === pattern || relPath === pattern;
  });
}

/**
 * Plans writes and prunes. Only paths owned by the previous lock are ever
 * pruned; unknown files in a managed directory are hand-written and kept.
 * @param {PreparedFile[]} prepared
 * @param {LockFile|undefined} oldLock
 * @param {Map<string, string>} diskHashes
 * @param {SyncConfig} cfg
 * @returns {Plan}
 */
export function planChanges(prepared, oldLock, diskHashes, cfg) {
  /** @type {Map<string, LockFileEntry>} */
  const oldFiles = new Map();
  for (const item of Object.values(oldLock?.items ?? {})) {
    for (const file of item.files) {
      oldFiles.set(file.path, file);
    }
  }
  const newItems = new Set(prepared.map((f) => f.item));
  const oldItems = new Set(Object.keys(oldLock?.items ?? {}));
  const newPaths = new Set(prepared.map((f) => f.path));
  const localMods = [...oldFiles]
    .filter(([p, entry]) => {
      const onDisk = diskHashes.get(p);
      return onDisk !== undefined && onDisk !== entry.sha256;
    })
    .map(([p]) => p)
    .sort();
  const writes = prepared.filter((f) => diskHashes.get(f.path) !== f.sha256);
  /**
   * @param {string} name
   * @returns {ItemStatus}
   */
  const itemStatus = (name) => {
    if (!oldItems.has(name)) {
      return "added";
    }
    const files = prepared.filter((f) => f.item === name);
    const changed = files.some((f) => {
      const old = oldFiles.get(f.path);
      return (
        !old || old.sourceSha256 !== f.sourceSha256 || old.sha256 !== f.sha256
      );
    });
    return changed ? "updated" : "unchanged";
  };
  /** @type {Record<ItemStatus, string[]>} */
  const byStatus = { added: [], unchanged: [], updated: [] };
  for (const name of [...newItems].sort()) {
    byStatus[itemStatus(name)].push(name);
  }
  const removed = [...oldItems].filter((n) => !newItems.has(n)).sort();
  const prunes = [...oldFiles.keys()]
    .filter(
      (p) => diskHashes.has(p) && !(newPaths.has(p) || matchesKeep(p, cfg.keep))
    )
    .sort();
  return {
    added: byStatus.added,
    localMods,
    prunes,
    removed,
    unchanged: byStatus.unchanged,
    updated: byStatus.updated,
    writes,
  };
}

/**
 * @param {Pick<LockFile, "packages">} lock
 * @param {PackageJson} pkgJson
 * @param {SyncConfig} cfg
 * @returns {DependencyDiff}
 */
export function diffDependencies(lock, pkgJson, cfg) {
  const declared = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
    ...Object.keys(pkgJson.peerDependencies ?? {}),
  ]);
  const required = new Set(
    Object.keys(lock.packages).filter((p) => !cfg.implicitDeps.includes(p))
  );
  const missing = [...required].filter((p) => !declared.has(p)).sort();
  const extraneous = Object.keys(pkgJson.dependencies ?? {})
    .filter(
      (p) =>
        !(
          required.has(p) ||
          cfg.implicitDeps.includes(p) ||
          cfg.keepDeps.includes(p)
        )
    )
    .sort();
  return { extraneous, missing };
}

/**
 * @template T
 * @param {string} file
 * @returns {Promise<T|undefined>}
 */
async function readJson(file) {
  try {
    return /** @type {T} */ (JSON.parse(await fs.readFile(file, "utf8")));
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }
    throw error;
  }
}

/**
 * @template T
 * @param {string} url
 * @param {string} [etag]
 * @returns {Promise<{ status: 200, body: T, etag?: string } | { status: 304, etag?: string }>}
 */
async function fetchJson(url, etag) {
  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/vnd.shadcn.v1+json, application/json;q=0.9",
    "User-Agent": "workspace-ui-sync",
  };
  if (etag) {
    headers["If-None-Match"] = etag;
  }
  const res = await fetch(url, { headers });
  if (res.status === 304) {
    return { etag, status: 304 };
  }
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return {
    body: /** @type {T} */ (await res.json()),
    etag: res.headers.get("etag") ?? undefined,
    status: 200,
  };
}

/**
 * @template T
 * @param {string} url
 * @param {string} cacheFile
 * @param {string} [etag]
 * @returns {Promise<{ body: T, etag?: string }>}
 */
async function fetchCached(url, cacheFile, etag) {
  const cachePath = path.join(CACHE_DIR, cacheFile);
  /** @type {T|undefined} */
  const cached = etag ? await readJson(cachePath) : undefined;
  /** @type {Awaited<ReturnType<typeof fetchJson<T>>>} */
  const res = await fetchJson(url, cached ? etag : undefined);
  if (res.status === 304 && cached) {
    return { body: cached, etag };
  }
  /** @type {Awaited<ReturnType<typeof fetchJson<T>>>} */
  const fresh = res.status === 200 ? res : await fetchJson(url);
  if (fresh.status !== 200) {
    throw new Error(`GET ${url} → unexpected 304 without a cached body`);
  }
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(fresh.body));
  return { body: fresh.body, etag: fresh.etag };
}

/**
 * @param {string[]} names
 * @param {LockFile|undefined} oldLock
 * @param {SyncConfig} cfg
 * @returns {Promise<Map<string, FetchedItem>>}
 */
async function fetchItems(names, oldLock, cfg) {
  /** @type {Map<string, FetchedItem>} */
  const results = new Map();
  const queue = [...names];
  /**
   * @param {string} name
   * @returns {Promise<void>}
   */
  const fetchOne = async (name) => {
    /** @type {{ body: RegistryItem, etag?: string }} */
    const { body, etag } = await fetchCached(
      `${cfg.registry}/${name}.json`,
      `items/${name}.json`,
      oldLock?.items[name]?.etag
    );
    if (!Array.isArray(body.files)) {
      throw new Error(`Item "${name}" has no files array`);
    }
    results.set(name, { etag, item: body });
  };
  const worker = async () => {
    while (queue.length > 0) {
      const name = queue.shift();
      if (name !== undefined) {
        await fetchOne(name);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(cfg.concurrency, names.length) }, worker)
  );
  return results;
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function walk(dir) {
  /** @type {import("node:fs").Dirent[]} */
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : Promise.resolve([full]);
    })
  );
  return nested.flat();
}

/**
 * @param {SyncConfig} cfg
 * @returns {string[]}
 */
const managedDirs = (cfg) => [...new Set(Object.values(cfg.paths))];

/**
 * @param {string} file
 * @returns {string}
 */
const toRelative = (file) =>
  path.relative(ROOT, file).split(path.sep).join("/");

/**
 * @param {SyncConfig} cfg
 * @returns {Promise<Map<string, string>>}
 */
async function hashManagedDirs(cfg) {
  /** @type {Map<string, string>} */
  const hashes = new Map();
  for (const dir of managedDirs(cfg)) {
    for (const file of await walk(path.join(ROOT, dir))) {
      hashes.set(toRelative(file), sha256(await fs.readFile(file, "utf8")));
    }
  }
  return hashes;
}

/**
 * @returns {Promise<string|undefined>}
 */
async function readStyles() {
  const files = (await walk(STYLES_DIR)).filter((f) => f.endsWith(".css"));
  if (files.length === 0) {
    return;
  }
  const parts = await Promise.all(files.map((f) => fs.readFile(f, "utf8")));
  return parts.join("\n");
}

/**
 * @param {SyncConfig} cfg
 * @returns {Promise<void>}
 */
async function assertNoLeaks(cfg) {
  /** @type {string[]} */
  const offenders = [];
  for (const dir of managedDirs(cfg)) {
    for (const file of await walk(path.join(ROOT, dir))) {
      const code = await fs.readFile(file, "utf8");
      if (LEAK_MARKERS.some((marker) => code.includes(marker))) {
        offenders.push(toRelative(file));
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Unrewritten registry specifiers in managed files:\n  ${offenders.join("\n  ")}`
    );
  }
}

/**
 * @param {string[]} items
 * @param {string} [indent]
 * @returns {string}
 */
const list = (items, indent = "    ") =>
  items.length > 0 ? `\n${indent}${items.join(`\n${indent}`)}` : " (none)";

/**
 * @param {RegistryItem} item
 * @param {string} globalsCss
 * @returns {string[]}
 */
function missingThemeVars(item, globalsCss) {
  return THEME_SCOPES.flatMap((scope) =>
    Object.keys(item.cssVars?.[scope] ?? {})
      .filter(
        (key) =>
          !globalsCss.includes(`--${key.replace(LEADING_DASHES_RE, "")}:`)
      )
      .map((key) => `${scope}:${key}`)
  );
}

/**
 * @param {string} name
 * @param {RegistryItem} item
 * @param {LockFile|undefined} oldLock
 * @param {string|undefined} globalsCss
 * @returns {string|undefined}
 */
function themeLine(name, item, oldLock, globalsCss) {
  const old = oldLock?.items[name];
  const changed =
    oldLock !== undefined &&
    stableJson({ css: item.css, cssVars: item.cssVars }) !==
      stableJson({ css: old?.css, cssVars: old?.cssVars });
  const missing = globalsCss ? missingThemeVars(item, globalsCss) : [];
  if (!(changed || missing.length > 0 || oldLock === undefined)) {
    return;
  }
  const suffix =
    missing.length > 0 ? ` missing in src/styles: ${missing.join(", ")}` : "";
  return `  ${name}${changed ? " (changed upstream)" : ""}${suffix}`;
}

/**
 * @param {Map<string, FetchedItem>} items
 * @param {LockFile|undefined} oldLock
 * @param {string|undefined} globalsCss
 * @returns {void}
 */
function reportCss(items, oldLock, globalsCss) {
  const lines = [...items]
    .sort()
    .filter(([, { item }]) => item.cssVars || item.css)
    .map(([name, { item }]) => themeLine(name, item, oldLock, globalsCss))
    .filter((line) => typeof line === "string");
  if (lines.length > 0) {
    console.log(
      `\nTheme (hand-merge into src/styles/cortex.css):\n${lines.join("\n")}`
    );
  }
}

/**
 * @param {Map<string, Set<string>>} map
 * @param {string} key
 * @param {string} item
 * @returns {void}
 */
const addTo = (map, key, item) => {
  const set = map.get(key) ?? new Set();
  set.add(item);
  map.set(key, set);
};

/**
 * @param {string} name
 * @param {RegistryFile} file
 * @param {Set<string>} selected
 * @param {Map<string, string>} owners
 * @param {SyncConfig} cfg
 * @returns {{ entry: LockFileEntry, code: string, externals: string[] }}
 */
function prepareFile(name, file, selected, owners, cfg) {
  if (file.target) {
    throw new Error(
      `"${name}" file ${file.path} sets target="${file.target}" (unsupported)`
    );
  }
  if (typeof file.content !== "string") {
    throw new Error(`"${name}" file ${file.path} has no content`);
  }
  const { packagePath } = mapRegistryPath(file.path, cfg);
  const owner = owners.get(packagePath);
  if (owner && owner !== name) {
    throw new Error(
      `Collision: "${name}" and "${owner}" both map to ${packagePath}`
    );
  }
  owners.set(packagePath, name);
  const { code, registryRefs, externals } = rewriteImports(file.content, cfg);
  const unselected = registryRefs.find(
    (ref) => !(selected.has(ref) || cfg.ambientRegistry.includes(ref))
  );
  if (unselected) {
    throw new Error(
      `"${name}" imports registry item "${unselected}" which is not selected`
    );
  }
  return {
    code,
    entry: {
      path: packagePath,
      registryPath: file.path,
      sha256: sha256(code),
      sourceSha256: sha256(file.content),
    },
    externals,
  };
}

/**
 * @param {string} name
 * @param {RegistryItem} item
 * @param {string|undefined} etag
 * @param {Set<string>} selected
 * @param {Map<string, string>} owners
 * @param {Prepared} out
 * @param {SyncConfig} cfg
 * @returns {void}
 */
function prepareItem(name, item, etag, selected, owners, out, cfg) {
  /** @type {Set<string>} */
  const deps = new Set();
  /**
   * @param {string} spec
   * @returns {void}
   */
  const external = (spec) => {
    const { pkg, asset } = packageNameOf(spec);
    if (asset) {
      addTo(out.assets, spec, name);
    }
    deps.add(pkg);
  };
  for (const raw of [
    ...(item.dependencies ?? []),
    ...(item.devDependencies ?? []),
  ]) {
    external(raw);
  }
  /** @type {LockFileEntry[]} */
  const files = [];
  for (const file of item.files) {
    const { entry, code, externals } = prepareFile(
      name,
      file,
      selected,
      owners,
      cfg
    );
    for (const spec of externals) {
      external(spec);
    }
    files.push(entry);
    out.prepared.push({ ...entry, code, item: name });
  }
  const dependencies = [...deps]
    .filter((p) => !cfg.implicitDeps.includes(p))
    .sort();
  for (const pkg of dependencies) {
    addTo(out.packages, pkg, name);
  }
  out.lockItems[name] = {
    type: item.type,
    ...(etag ? { etag } : {}),
    dependencies,
    registryDependencies: (item.registryDependencies ?? [])
      .map((d) => normalizeRegistryDep(d, cfg))
      .sort(),
    ...(item.cssVars ? { cssVars: item.cssVars } : {}),
    ...(item.css ? { css: item.css } : {}),
    files,
  };
}

/**
 * @param {Plan} plan
 * @param {string[]} notes
 * @param {DependencyDiff} deps
 * @param {LockFile} lock
 * @param {SyncConfig} cfg
 * @param {boolean} force
 * @returns {void}
 */
function printReport(plan, notes, deps, lock, cfg, force) {
  console.log(
    `Registry: ${cfg.registry}  (${Object.keys(lock.items).length} items, ${plan.writes.length + plan.unchanged.length} planned)`
  );
  console.log(`  added:     ${plan.added.length}${list(plan.added)}`);
  console.log(`  updated:   ${plan.updated.length}${list(plan.updated)}`);
  console.log(`  removed:   ${plan.removed.length}${list(plan.removed)}`);
  console.log(`  unchanged: ${plan.unchanged.length}`);
  console.log(
    `  writes:    ${plan.writes.length}${list(plan.writes.map((f) => f.path))}`
  );
  console.log(`  prunes:    ${plan.prunes.length}${list(plan.prunes)}`);
  if (plan.localMods.length > 0) {
    console.log(
      `  locally modified (${force ? "overwriting" : "skipped; use --force"}):${list(plan.localMods)}`
    );
  }
  for (const note of notes) {
    console.log(`  note: ${note}`);
  }
  if (deps.missing.length > 0) {
    console.log(
      `\nMissing dependencies:\n    bun add ${deps.missing.join(" ")}`
    );
  }
  const assets = Object.keys(lock.assets);
  if (assets.length > 0) {
    console.log(
      `CSS assets to @import (see src/styles/globals.css): ${assets.join(", ")}`
    );
  }
}

/**
 * @param {Plan} plan
 * @param {LockFile} newLock
 * @param {LockFile|undefined} oldLock
 * @param {boolean} force
 * @returns {Promise<Set<string>>}
 */
async function applyPlan(plan, newLock, oldLock, force) {
  const blocked = new Set(force ? [] : plan.localMods);
  for (const file of plan.writes.filter((f) => !blocked.has(f.path))) {
    const abs = path.join(ROOT, file.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, file.code);
  }
  for (const rel of plan.prunes) {
    await fs.rm(path.join(ROOT, rel), { force: true });
  }
  if (blocked.size > 0 && oldLock) {
    for (const [name, item] of Object.entries(newLock.items)) {
      const old = oldLock.items[name];
      if (old) {
        item.files = item.files.map((f) =>
          blocked.has(f.path)
            ? (old.files.find((o) => o.path === f.path) ?? f)
            : f
        );
      }
    }
  }
  await fs.writeFile(LOCK_PATH, stableJson(newLock));
  return blocked;
}

/**
 * @param {string[]} missing
 * @returns {void}
 */
function installMissing(missing) {
  console.log(`\nInstalling: bun add ${missing.join(" ")}`);
  const proc = spawnSync("bun", ["add", ...missing], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (proc.status !== 0) {
    process.exit(proc.status ?? 1);
  }
}

/**
 * @param {Map<string, Set<string>>} map
 * @returns {Record<string, string[]>}
 */
const toLists = (map) =>
  Object.fromEntries([...map].map(([k, v]) => [k, [...v].sort()]));

/**
 * @param {string[]} [argv]
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  const cfg = config;
  /** @type {LockFile|undefined} */
  const oldLock = await readJson(LOCK_PATH);
  /** @type {PackageJson} */
  const pkgJson = (await readJson(path.join(ROOT, "package.json"))) ?? {};
  /** @type {{ body: Catalogue, etag?: string }} */
  const { body: catalogue, etag: registryEtag } = await fetchCached(
    `${cfg.registry}/registry.json`,
    "registry.json",
    oldLock?.registryEtag
  );
  const index = new Map(catalogue.items.map((item) => [item.name, item]));
  const roots = selectRoots(catalogue.items, cfg, flags.only);
  const { names, notes } = resolveClosure(roots, index, cfg);
  const fetched = await fetchItems(names, oldLock, cfg);
  /** @type {Prepared} */
  const out = {
    assets: new Map(),
    lockItems: {},
    packages: new Map(),
    prepared: [],
  };
  /** @type {Map<string, string>} */
  const owners = new Map();
  const selected = new Set(names);
  for (const name of names) {
    const entry = fetched.get(name);
    if (!entry) {
      throw new Error(`Registry item "${name}" was not fetched`);
    }
    prepareItem(name, entry.item, entry.etag, selected, owners, out, cfg);
  }
  const diskHashes = await hashManagedDirs(cfg);
  const plan = planChanges(out.prepared, oldLock, diskHashes, cfg);
  /** @type {LockFile} */
  const newLock = {
    registry: cfg.registry,
    version: 1,
    ...(registryEtag ? { registryEtag } : {}),
    assets: toLists(out.assets),
    generatedAt: oldLock?.generatedAt ?? new Date().toISOString(),
    items: out.lockItems,
    packages: toLists(out.packages),
  };
  const deps = diffDependencies(newLock, pkgJson, cfg);
  const lockChanged =
    stableJson({ ...newLock, generatedAt: "" }) !==
    stableJson({ ...(oldLock ?? {}), generatedAt: "" });
  const hasChanges =
    plan.writes.length > 0 || plan.prunes.length > 0 || lockChanged;
  printReport(plan, notes, deps, newLock, cfg, flags.force);
  reportCss(fetched, oldLock, await readStyles());
  if (flags.check) {
    const drift =
      hasChanges || deps.missing.length > 0 || plan.localMods.length > 0;
    console.log(drift ? "\n✗ drift detected" : "\n✓ in sync");
    process.exit(drift ? 1 : 0);
  }
  if (flags.dryRun) {
    console.log("\n(dry run, nothing written)");
    return;
  }
  if (hasChanges) {
    newLock.generatedAt = new Date().toISOString();
  }
  const blocked = await applyPlan(plan, newLock, oldLock, flags.force);
  await assertNoLeaks(cfg);
  if (flags.install && deps.missing.length > 0) {
    installMissing(deps.missing);
  }
  if (blocked.size > 0) {
    console.log(
      `\n✗ ${blocked.size} locally modified file(s) not overwritten (use --force)`
    );
    process.exit(1);
  }
  console.log(hasChanges ? "\n✓ synced" : "\n✓ already in sync");
}

// Bun sets `import.meta.main`; on Node compare argv[1] so importing the
// module from tests stays inert on both runtimes.
const isMainModule =
  typeof import.meta.main === "boolean"
    ? import.meta.main
    : typeof process.argv[1] === "string" &&
      path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((/** @type {unknown} */ error) => {
    console.error(
      `\n✗ ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(2);
  });
}
