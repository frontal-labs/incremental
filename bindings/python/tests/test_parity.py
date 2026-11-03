"""G6: byte-identical plans. For every query case, the Python client's plan,
serialized as json.dumps(separators=(',',':')), equals the body of the engine's
serve response, and (where the CLI takes the same inputs) the CLI stdout
minus its trailing newline."""

import os
import shutil
import subprocess
import tempfile
import unittest

from . import _support as S
from ._conformance import _seeded_store, _query_plan

SERVE_PREFIX = '{"id":500,"result":'


def _serve_body(store: str, case: dict) -> bytes:
    """The result body of the serve response to the same affected request."""
    hello = {"id": 1, "method": "hello", "params": {"protocol": 1, "client": {"name": "g6", "version": "0"}}}
    req = {"id": 500, "method": "affected",
           "params": {"changes": S.query_changes(case), "options": S.query_options(case)}}
    lines = [S.dumps(hello), S.dumps(req)]
    r = subprocess.run([S.ENGINE, "serve", "--store", store, "--root", S.worktree(case)],
                       input="\n".join(lines) + "\n", capture_output=True, text=True, timeout=60)
    found = [ln for ln in r.stdout.split("\n") if ln.startswith(SERVE_PREFIX)]
    if len(found) != 1 or not found[0].endswith("}"):
        raise AssertionError(f"no single result line for id 500: {r.stdout!r} {r.stderr!r}")
    return found[0][len(SERVE_PREFIX):-1].encode("utf-8")


def _cli_stdout(store: str, case: dict, tmp: str) -> bytes:
    q = case["query"]
    ch = os.path.join(tmp, "changes.json")
    ctx = os.path.join(tmp, "context.json")
    with open(ch, "w", encoding="utf-8") as fh:
        fh.write(S.dumps(S.query_changes(case)))
    with open(ctx, "w", encoding="utf-8") as fh:
        fh.write(S.dumps(q["context"]))
    argv = [S.ENGINE, "affected", "--changes", ch, "--baseline", q["baseline"], "--context", ctx,
            "--store", store, "--root", S.worktree(case), "--policy", case["mode"]]
    if q.get("verify"):
        argv.append("--verify")
    # The CLI has no env, config or declared_tasks flags; the client run is
    # made with the same omissions (see _cli_options).
    r = subprocess.run(argv, capture_output=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(f"cli exit {r.returncode}: {r.stderr!r}")
    return r.stdout


def _cli_eligible(case: dict) -> bool:
    return "context" in case["query"]


def _cli_options(case: dict) -> dict:
    """The options the CLI can express: it has no env, config or declared_tasks flags."""
    opts = S.query_options(case)
    for key in ("env", "config", "declared_tasks"):
        opts.pop(key, None)
    return opts


def _query_cases():
    out = []
    for path in sorted(__import__("glob").glob(os.path.join(S.CASES_DIR, "*.json"))):
        case = S.load_case(path)
        if "query" in case:
            out.append(case)
    return out


class TestByteParity(unittest.TestCase):
    counts = {"query": 0, "serve": 0, "cli_eligible": 0, "cli": 0}

    @classmethod
    def setUpClass(cls):
        S.require_engine()

    def test_serve_and_cli_bytes_match_client(self):
        cases = _query_cases()
        self.assertEqual(len(cases), 36, "expected the 36 query cases of conformance/cases")
        for case in cases:
            with self.subTest(case=case["id"]):
                self.__class__.counts["query"] += 1
                store = _seeded_store(case)  # same seeding and post-log step as run.mjs
                try:
                    if "post_raw_log" in case:
                        with open(os.path.join(store, "tg.log"), "a", encoding="utf-8") as fh:
                            fh.write(case["post_raw_log"])
                    plan = S.dumps(_query_plan(case, store)).encode("utf-8")
                    body = _serve_body(store, case)
                    self.assertEqual(plan, body, "client plan bytes differ from the serve result body")
                    self.__class__.counts["serve"] += 1
                    if _cli_eligible(case):
                        self.__class__.counts["cli_eligible"] += 1
                        tmp = tempfile.mkdtemp(prefix="bp-g6-")
                        try:
                            cli = _cli_stdout(store, case, tmp)
                        finally:
                            shutil.rmtree(tmp, ignore_errors=True)
                        client = S.open_client(store, S.worktree(case))
                        try:
                            cli_plan = S.dumps(client.affected(S.query_changes(case), **_cli_options(case)))
                        finally:
                            client.close()
                        self.assertEqual(cli_plan.encode("utf-8") + b"\n", cli,
                                         "client plan bytes differ from CLI stdout")
                        self.__class__.counts["cli"] += 1
                finally:
                    S.cleanup(store)

    @classmethod
    def tearDownClass(cls):
        c = cls.counts
        print(f"\nG6 counts: query cases {c['query']}, serve parity {c['serve']}, "
              f"CLI-eligible {c['cli_eligible']}, CLI parity {c['cli']}")
