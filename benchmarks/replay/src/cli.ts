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
    switch (a) {
      case "--repo": out.repo = value(); break;
      case "--commits": {
        out.commits = Number(value());
        if (!Number.isInteger(out.commits) || out.commits < 1) throw new Error("--commits needs a positive integer");
        break;
      }
      case "--store": out.store = value(); break;
      case "--out": out.out = value(); break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  return out;
}
