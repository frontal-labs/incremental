import type { CliArgs } from "./types.js";

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    if (a === "--repo") {
      out.repo = value();
    } else if (a === "--commits") {
      out.commits = Number(value());
      if (!Number.isInteger(out.commits) || out.commits < 1)
        throw new Error("--commits needs a positive integer");
    } else if (a === "--store") {
      out.store = value();
    } else if (a === "--sources") {
      out.sources = value()
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (a === "--out") {
      out.out = value();
    } else {
      throw new Error(`unknown option ${a}`);
    }
  }
  return out;
}
