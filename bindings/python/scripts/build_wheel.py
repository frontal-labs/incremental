"""Build a platform wheel that carries one engine prebuild.

    python scripts/build_wheel.py --target darwin-arm64 --outdir dist

The engine binary comes from packages/engine/prebuilds/<target>/, the same
artifact @incremental/engine ships. Each wheel holds exactly one binary, so it
is tagged for that platform. Build the engine for the target first
(scripts/build-prebuilds.mjs in packages/engine).
"""

import argparse
import pathlib
import shutil
import subprocess
import sys

PY_ROOT = pathlib.Path(__file__).resolve().parent.parent
PREBUILDS = PY_ROOT.parent.parent / "packages" / "engine" / "prebuilds"
DEST = PY_ROOT / "incremental_client" / "prebuilds"

# npm-style triple -> wheel platform tag. Each tag states the oldest OS the
# binary runs on: macOS 11.0 (LC_BUILD_VERSION minos) and glibc 2.34 for Linux
# (highest GLIBC symbol in the binary; built on Ubuntu 22.04 for both Linux arches).
PLAT_TAGS = {
    "darwin-arm64": "macosx_11_0_arm64",
    "darwin-x64": "macosx_11_0_x86_64",
    "linux-x64": "manylinux_2_34_x86_64",
    "linux-arm64": "manylinux_2_34_aarch64",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", required=True, choices=sorted(PLAT_TAGS))
    parser.add_argument("--outdir", default=str(PY_ROOT / "dist"))
    args = parser.parse_args()

    binary = PREBUILDS / args.target / "incremental"
    if not binary.is_file():
        print(f"build_wheel: no engine prebuild at {binary}; build it first", file=sys.stderr)
        return 1

    # Stage exactly one binary so the wheel cannot carry another platform's.
    # setuptools keeps build/ between runs and would reuse stale copies of
    # earlier targets, so that directory is cleared too.
    for stale in (DEST, PY_ROOT / "build", *PY_ROOT.glob("*.egg-info")):
        shutil.rmtree(stale, ignore_errors=True)
    (DEST / args.target).mkdir(parents=True)
    shutil.copy2(binary, DEST / args.target / "incremental")
    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "build",
                "--wheel",
                "--outdir",
                args.outdir,
                "--config-setting=--build-option=--plat-name=" + PLAT_TAGS[args.target],
            ],
            cwd=PY_ROOT,
            check=True,
        )
    finally:
        for stale in (DEST, PY_ROOT / "build", *PY_ROOT.glob("*.egg-info")):
            shutil.rmtree(stale, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
