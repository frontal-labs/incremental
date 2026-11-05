"""Shared test setup: sys.path, repo paths, store and case helpers."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PY_ROOT = os.path.dirname(HERE)                       # bindings/python
REPO = os.path.abspath(os.path.join(PY_ROOT, "..", ".."))
SRC = os.path.join(PY_ROOT, "src")
CASES_DIR = os.path.join(REPO, "conformance", "cases")
SEED_DEFAULT = os.path.join(REPO, "conformance", "stores", "base.jsonl")
FAKE_ENGINE = os.path.join(HERE, "fake_engine.py")

if SRC not in sys.path:
    sys.path.insert(0, SRC)

import incremental  # noqa: E402  (needs the sys.path entry above)
from incremental import IncrementalError, connect  # noqa: E402,F401

ENGINE = os.environ.get("INCREMENTAL_ENGINE", os.path.join(REPO, "core", "dist", "incremental"))

COMPARED = ("tasks", "unobserved", "ignored", "deleted_tasks", "fallback", "confidence")


def dumps(value) -> str:
    """The byte form used for plans: compact, key order kept."""
    return json.dumps(value, separators=(",", ":"), sort_keys=False)


def require_engine() -> None:
    if not os.path.exists(ENGINE):
        raise unittest.SkipTest(f"engine missing at {ENGINE}: run make build")


def new_store(name: str = "store") -> str:
    """A fresh store directory, created by the engine's own init command."""
    base = tempfile.mkdtemp(prefix="bp-py-")
    store = os.path.join(base, name)
    r = subprocess.run([ENGINE, "init", "--store", store], capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(f"init failed: {r.stdout} {r.stderr}")
    return store


def cleanup(store: str) -> None:
    shutil.rmtree(os.path.dirname(store), ignore_errors=True)


def load_case(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def worktree(case: dict) -> str:
    return os.path.join(REPO, "conformance", "worktrees", case.get("worktree", "base"))


def seed_messages(path: str) -> list:
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def apply_messages(client, messages) -> None:
    """Replay protocol messages (observe, advance, forget) through the client."""
    for m in messages:
        getattr(client, m["method"])(**m["params"])


def query_options(case: dict) -> dict:
    q = case["query"]
    opts = {"baseline": q["baseline"], "verify": q.get("verify", False), "policy": case["mode"]}
    if "context" in q:
        opts["context"] = q["context"]
    if "env" in q:
        opts["env"] = q["env"]
    if "declared_tasks" in q:
        opts["declared_tasks"] = q["declared_tasks"]
    if "config" in case:
        opts["config"] = case["config"]
    return opts


def query_changes(case: dict) -> dict:
    return {"baseline": case["query"]["baseline"], "changes": case["query"]["changes"]}


def mismatches(plan: dict, expect: dict) -> list:
    out = []
    for key in COMPARED:
        if key not in expect:
            continue
        if dumps(plan.get(key)) != dumps(expect[key]):
            out.append(f"{key}: want {dumps(expect[key])} got {dumps(plan.get(key))}")
    return out


def open_client(store: str, root: str, **kw):
    return connect(store, engine=ENGINE, root=root, **kw)
