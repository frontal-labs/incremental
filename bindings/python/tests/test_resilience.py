"""Restart, timeout, serialization and error behaviour of the client."""

import os
import signal
import sys
import tempfile
import threading
import time
import unittest

from . import _support as S
from backplane import BackplaneError, connect
from backplane._transport import _FifoLock


def _wait_dead(client, limit=5.0):
    end = time.time() + limit
    while client.engine_pid is not None:  # engine_pid reaps an exited child
        if time.time() > end:
            raise AssertionError("engine did not exit")
        time.sleep(0.01)


class TestRestart(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        S.require_engine()

    def setUp(self):
        self.store = S.new_store("restart")
        client = S.open_client(self.store, S.REPO)
        S.apply_messages(client, S.seed_messages(S.SEED_DEFAULT))
        client.close()

    def tearDown(self):
        S.cleanup(self.store)

    def test_read_after_kill_restarts_and_reruns_hello(self):
        client = S.open_client(self.store, S.REPO)
        try:
            first = client.engine_pid
            self.assertIsNotNone(first)
            os.kill(first, signal.SIGKILL)
            _wait_dead(client)
            self.assertEqual(client.baseline(), {"baseline": "b1"})
            second = client.engine_pid
            self.assertIsNotNone(second)
            self.assertNotEqual(first, second)
            self.assertEqual(client.hello()["protocol"], 1)
        finally:
            client.close()

    def test_mutating_call_after_kill_restarts_before_writing(self):
        client = S.open_client(self.store, S.REPO)
        try:
            os.kill(client.engine_pid, signal.SIGKILL)
            _wait_dead(client)
            before = client.stats()["observations"]
            self.assertEqual(client.forget("packages/none.test.ts"), {"forgotten": True})
            self.assertEqual(client.stats()["observations"], before)
        finally:
            client.close()

    def test_restart_off_raises_engine_exited(self):
        client = connect(self.store, engine=S.ENGINE, root=S.REPO, restart=False)
        try:
            os.kill(client.engine_pid, signal.SIGKILL)
            _wait_dead(client)
            with self.assertRaises(BackplaneError) as cm:
                client.baseline()
            self.assertEqual(cm.exception.code, "engine_exited")
        finally:
            client.close()


class TestTimeoutAndFakeEngine(unittest.TestCase):
    """Uses a stand-in engine (tests/fake_engine.py) so the timeout is exact."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="bp-fake-")
        self.marker = os.path.join(self.dir, "die-once")
        os.environ["FAKE_MARKER"] = self.marker
        self.fake = [sys.executable, S.FAKE_ENGINE]

    def tearDown(self):
        os.environ.pop("FAKE_MARKER", None)
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_timeout_raises_code_timeout_and_restarts(self):
        client = connect(self.dir, engine=self.fake, root=self.dir, timeout=0.5)
        try:
            first = client.engine_pid
            with self.assertRaises(BackplaneError) as cm:
                client.stats()  # the fake engine never answers stats
            self.assertEqual(cm.exception.code, "timeout")
            self.assertEqual(cm.exception.data, {"partial": False})
            self.assertIsNone(client.engine_pid)
            self.assertEqual(client.baseline(), {"baseline": None})
            self.assertNotEqual(client.engine_pid, first)
        finally:
            client.close()

    def test_read_only_call_retried_after_death_in_flight(self):
        open(self.marker, "w").close()  # the first ping kills the engine
        client = connect(self.dir, engine=self.fake, root=self.dir, timeout=5)
        try:
            self.assertEqual(client.ping(), {"pong": True})
            self.assertFalse(os.path.exists(self.marker))
        finally:
            client.close()

    def test_mutating_call_not_retried_after_death_in_flight(self):
        client = connect(self.dir, engine=self.fake, root=self.dir, timeout=5)
        try:
            with self.assertRaises(BackplaneError) as cm:
                client.forget("x")  # the fake engine exits without answering
            self.assertEqual(cm.exception.code, "engine_exited")
            self.assertEqual(client.baseline(), {"baseline": None})  # next call restarts
        finally:
            client.close()

    def test_hello_is_repeated_on_restart(self):
        client = connect(self.dir, engine=self.fake, root=self.dir, timeout=5)
        try:
            self.assertEqual(client.hello()["store"], f"pid{client.engine_pid}")
        finally:
            client.close()


class TestSerialization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        S.require_engine()

    def test_fifo_lock_grants_in_arrival_order(self):
        lock = _FifoLock()
        order = []
        lock.acquire()

        def worker(n):
            with lock:
                order.append(n)

        threads = []
        for n in range(6):
            t = threading.Thread(target=worker, args=(n,))
            threads.append(t)
            t.start()
            time.sleep(0.02)  # arrival order is the start order
        lock.release()
        for t in threads:
            t.join()
        self.assertEqual(order, list(range(6)))

    def test_threads_share_one_client_without_interleaving(self):
        store = S.new_store("threads")
        try:
            client = S.open_client(store, S.REPO)
            S.apply_messages(client, S.seed_messages(S.SEED_DEFAULT))
            errors = []

            def worker(w):
                try:
                    for i in range(10):
                        ack = client.observe({
                            "task": f"packages/core/src/t/w{w}_{i}.test.ts", "baseline": "b1",
                            "dirty": False, "outcome": "pass", "inputs": [], "outputs": [],
                            "context": {"lockfile": "sha256:l1", "tsconfig": "sha256:t1", "pkgjson": "sha256:p1",
                                        "runner": "vitest@4.1.12", "node": "22.11.0", "fmt": 1,
                                        "caps": {"probes": True, "dirs": True, "env": True}}})
                        if ack != {"accepted": True}:
                            errors.append(ack)
                        if client.baseline() != {"baseline": "b1"}:
                            errors.append("baseline")
                except Exception as exc:  # noqa: BLE001
                    errors.append(repr(exc))

            threads = [threading.Thread(target=worker, args=(w,)) for w in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(errors, [])
            stats = client.stats()
            self.assertEqual(stats["observations"], 7 + 80)
            self.assertEqual(stats["tasks"], 7 + 80)
            client.close()
        finally:
            S.cleanup(store)


class TestErrorsAndLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        S.require_engine()

    def test_missing_store_raises_store_missing(self):
        with self.assertRaises(BackplaneError) as cm:
            connect(os.path.join(tempfile.mkdtemp(), "nope"), engine=S.ENGINE, root=S.REPO)
        self.assertEqual(cm.exception.code, "store_missing")

    def test_conflict_carries_code_and_data(self):
        store = S.new_store("conflict")
        try:
            with S.open_client(store, S.REPO) as client:
                S.apply_messages(client, S.seed_messages(S.SEED_DEFAULT))
                with self.assertRaises(BackplaneError) as cm:
                    client.advance("b2", "b0")
                self.assertEqual(cm.exception.code, "baseline_conflict")
                # PLAN 9.1: the error carries expected and actual.
                self.assertEqual(cm.exception.data, {"expected": "b0", "actual": "b1"})
                self.assertEqual(client.baseline(), {"baseline": "b1"})
        finally:
            S.cleanup(store)

    def test_close_is_idempotent_and_later_calls_raise_closed(self):
        store = S.new_store("closed")
        try:
            client = S.open_client(store, S.REPO)
            client.close()
            client.close()
            self.assertIsNone(client.engine_pid)
            with self.assertRaises(BackplaneError) as cm:
                client.stats()
            self.assertEqual(cm.exception.code, "closed")
        finally:
            S.cleanup(store)

    def test_context_manager_stops_engine(self):
        store = S.new_store("ctx")
        try:
            with S.open_client(store, S.REPO) as client:
                self.assertIsNotNone(client.engine_pid)
                self.assertEqual(client.ping(), {"pong": True})
            self.assertIsNone(client.engine_pid)
        finally:
            S.cleanup(store)

    def test_observe_many_and_forget_and_explain(self):
        store = S.new_store("api")
        try:
            with S.open_client(store, S.REPO) as client:
                S.apply_messages(client, S.seed_messages(S.SEED_DEFAULT))
                obs = {"task": "packages/core/src/m.test.ts", "baseline": "b1", "dirty": False,
                       "outcome": "pass", "inputs": [], "outputs": [],
                       "context": {"lockfile": "sha256:l1", "tsconfig": "sha256:t1", "pkgjson": "sha256:p1",
                                   "runner": "vitest@4.1.12", "node": "22.11.0", "fmt": 1,
                                   "caps": {"probes": True, "dirs": True, "env": True}}}
                self.assertEqual(client.observe_many([obs, dict(obs, task=obs["task"] + "2")]),
                                 {"accepted": 2})
                self.assertIn("task", client.explain(obs["task"]))
                before = client.stats()["tasks"]
                self.assertEqual(client.forget(obs["task"]), {"forgotten": True})
                self.assertEqual(client.stats()["tasks"], before - 1)
        finally:
            S.cleanup(store)
