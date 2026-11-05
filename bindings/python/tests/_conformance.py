"""Runs one conformance case through the Python client.

Mirrors conformance/run.mjs: the same stores, the same comparisons, the same
determinism checks. Returns a list of mismatch strings (empty means pass).
Expectations come from the case files only; nothing here computes them.
"""

import os
import threading

from incremental import IncrementalError
from incremental._transport import Engine

from . import _support as S

HELLO_PARAMS = {"protocol": 1, "client": {"name": "conformance", "version": "0.0.0"}}
CONTEXT_OK = {
    "lockfile": "sha256:l1",
    "tsconfig": "sha256:t1",
    "pkgjson": "sha256:p1",
    "runner": "vitest@4.1.12",
    "node": "22.11.0",
    "fmt": 1,
    "caps": {"probes": True, "dirs": True, "env": True},
}


def run_case(case: dict) -> list:
    if case.get("determinism") == "index":
        return _run_index(case)
    if case.get("kind") == "concurrency":
        return _run_concurrency(case)
    if "action" in case and case["action"]["method"] == "hello":
        return _run_hello_action(case)
    if "action" in case:
        return _run_action(case)
    if "raw_lines" in case:
        return _run_raw_lines(case)
    if "post_raw_log" in case:
        return _run_post_raw_log(case)
    return _run_query(case)


def _seeded_store(case: dict) -> str:
    store = S.new_store(case["id"])
    seed = S.seed_messages(os.path.join(S.REPO, case["store"]["from"]))
    seed += [dict(m) for m in case["store"].get("append", [])]
    client = S.open_client(store, S.worktree(case))
    try:
        S.apply_messages(client, seed)
    finally:
        client.close()
    return store


def _query_plan(case: dict, store: str) -> dict:
    client = S.open_client(store, S.worktree(case))
    try:
        return client.affected(S.query_changes(case), **S.query_options(case))
    finally:
        client.close()


def _run_query(case: dict) -> list:
    store = _seeded_store(case)
    try:
        plan = _query_plan(case, store)
        diffs = S.mismatches(plan, case["expect"])
        if case.get("determinism") == "repeat":
            client = S.open_client(store, S.worktree(case))
            try:
                first = client.affected(S.query_changes(case), **S.query_options(case))
                second = client.affected(S.query_changes(case), **S.query_options(case))
            finally:
                client.close()
            if S.dumps(first) != S.dumps(second):
                diffs.append("repeat: bytes differ")
        if case.get("determinism") == "shuffle":
            changes = S.query_changes(case)
            changes["changes"] = list(reversed(changes["changes"]))
            client = S.open_client(store, S.worktree(case))
            try:
                other = client.affected(changes, **S.query_options(case))
            finally:
                client.close()
            if S.dumps(plan) != S.dumps(other):
                diffs.append("shuffle: bytes differ from reversed input order")
        if case.get("determinism") == "cache":
            cache = os.path.join(store, "stat.cache")
            cached = os.path.exists(cache)
            client = S.open_client(store, S.worktree(case))
            try:
                again = client.affected(S.query_changes(case), **S.query_options(case))
            finally:
                client.close()
            if os.path.exists(cache):
                os.remove(cache)
            cold = _query_plan(case, store)
            if not cached:
                diffs.append("cache: stat.cache was not written by verify")
            if S.dumps(again) != S.dumps(plan) or S.dumps(cold) != S.dumps(plan):
                diffs.append("cache: answer changed with the cache")
        return diffs
    finally:
        S.cleanup(store)


def _run_hello_action(case: dict) -> list:
    """Protocol-level: hello with an unsupported version. The public client
    always sends protocol 1, so this goes through the transport layer.
    """
    store = S.new_store(case["id"])
    try:
        eng = Engine([S.ENGINE, "serve", "--store", store, "--root", S.REPO], timeout=5)
        eng.start()
        try:
            eng.request(case["action"]["method"], case["action"]["params"])
            return ["hello with protocol 2 was accepted"]
        except IncrementalError as err:
            diffs = []
            if err.code != case["expect"]["error"]:
                diffs.append(f"error: want {case['expect']['error']} got {err.code}")
            status = eng.wait_exit(5)
            if status != 2:
                diffs.append(f"exit status: want 2 got {status}")
            return diffs
        finally:
            eng.stop(graceful=False, wait=0)
    finally:
        S.cleanup(store)


def _run_action(case: dict) -> list:
    store = _seeded_store(case)
    try:
        client = S.open_client(store, S.worktree(case))
        try:
            diffs = []
            act = case["action"]
            try:
                getattr(client, act["method"])(**act["params"])
                diffs.append(f"error: want {case['expect']['error']} got no error")
            except IncrementalError as err:
                if err.code != case["expect"]["error"]:
                    diffs.append(f"error: want {case['expect']['error']} got {err.code}")
            if "baseline_after" in case["expect"]:
                after = client.baseline()["baseline"]
                if after != case["expect"]["baseline_after"]:
                    diffs.append(
                        f"baseline_after: want {case['expect']['baseline_after']} got {after}"
                    )
            return diffs
        finally:
            client.close()
    finally:
        S.cleanup(store)


def _run_raw_lines(case: dict) -> list:
    store = _seeded_store(case)
    try:
        eng = Engine([S.ENGINE, "serve", "--store", store, "--root", S.REPO], timeout=5)
        eng.start()
        try:
            eng.request("hello", HELLO_PARAMS)
            diffs = []
            want = case["expect"]["responses"]
            # The first raw line is malformed. The second is a valid ping with id 7.
            eng.send_raw(case["raw_lines"][0].encode("utf-8"))
            first = eng.read_response(5)
            if (
                first.get("id") is not None
                or first.get("error", {}).get("code") != want[0]["error_code"]
            ):
                diffs.append(f"response 0: got {S.dumps(first)}")
            eng.send_raw(case["raw_lines"][1].encode("utf-8"))
            second = eng.read_response(5)
            if second.get("id") != want[1]["id"] or S.dumps(second.get("result")) != S.dumps(
                want[1]["result"]
            ):
                diffs.append(f"response 1: got {S.dumps(second)}")
            return diffs
        finally:
            eng.stop(graceful=False, wait=0)
    finally:
        S.cleanup(store)


def _run_post_raw_log(case: dict) -> list:
    store = _seeded_store(case)
    try:
        with open(os.path.join(store, "tg.log"), "a", encoding="utf-8") as fh:
            fh.write(case["post_raw_log"])
        plan = _query_plan(case, store)
        return S.mismatches(plan, case["expect"])
    finally:
        S.cleanup(store)


def _run_index(case: dict) -> list:
    store = _seeded_store(case)
    try:
        idx = os.path.join(store, "tg.idx")
        with open(idx, "rb") as fh:
            saved = fh.read()
        opts = S.query_options(case)
        changes = S.query_changes(case)

        def plan_once():
            c = S.open_client(store, S.worktree(case))
            try:
                return c.affected(changes, **opts)
            finally:
                c.close()  # the engine writes tg.idx at exit

        a = plan_once()  # from the index
        os.remove(idx)
        b = plan_once()  # rebuilt from the log
        c = S.open_client(store, S.worktree(case))
        try:
            c.observe(
                {
                    "task": "packages/core/src/extra.test.ts",
                    "baseline": "b1",
                    "dirty": False,
                    "outcome": "pass",
                    "context": CONTEXT_OK,
                    "inputs": [],
                }
            )
        finally:
            c.close()
        with open(idx, "wb") as fh:  # stale index, then the log tail after it
            fh.write(saved)
        cdelta = plan_once()
        os.remove(idx)
        d = plan_once()  # rebuilt, after the same log growth

        diffs = []
        if S.dumps(a) != S.dumps(b):
            diffs.append("index plan differs from rebuilt plan")
        if S.dumps(cdelta) != S.dumps(d):
            diffs.append("delta plan differs from rebuilt plan")
        diffs += S.mismatches(a, case["expect"])
        return diffs
    finally:
        S.cleanup(store)


def _run_concurrency(case: dict) -> list:
    store = _seeded_store(case)
    try:
        errors = []
        per = case["per_writer"]

        def writer(w):
            try:
                client = S.open_client(store, S.worktree(case))
                try:
                    for i in range(per):
                        ack = client.observe(
                            {
                                "task": f"packages/core/src/gen/w{w}_{i}.test.ts",
                                "baseline": "b1",
                                "dirty": False,
                                "context": CONTEXT_OK,
                                "inputs": [],
                                "outputs": [],
                                "outcome": "pass",
                                "duration_ms": 1,
                            }
                        )
                        if ack != {"accepted": True}:
                            errors.append(f"writer {w}: ack {ack}")
                finally:
                    client.close()
            except Exception as exc:  # noqa: BLE001 - reported as a mismatch below
                errors.append(f"writer {w}: {exc!r}")

        threads = [threading.Thread(target=writer, args=(w,)) for w in range(case["writers"])]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        client = S.open_client(store, S.worktree(case))
        try:
            stats = client.stats()
        finally:
            client.close()
        diffs = list(errors)
        accepted = case["writers"] * per
        if stats["tasks"] != case["expect"]["tasks"]:
            diffs.append(
                f"tasks: want {case['expect']['tasks']} got {stats['tasks']} (accepted {accepted})"
            )
        if stats["observations"] != case["expect"]["observations"]:
            diffs.append(
                f"observations: want {case['expect']['observations']} got {stats['observations']}"
            )
        return diffs
    finally:
        S.cleanup(store)
