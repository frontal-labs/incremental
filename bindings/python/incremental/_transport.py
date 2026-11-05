"""Engine process and line protocol. Internal: use incremental.connect instead."""

import json
import os
import queue
import subprocess
import threading
from typing import Any, Sequence

from .errors import IncrementalError

_EOF = object()


class _FifoLock:
    """A lock that grants waiting threads in arrival order."""

    def __init__(self):
        self._cond = threading.Condition()
        self._next = 0
        self._serving = 0

    def acquire(self):
        with self._cond:
            ticket = self._next
            self._next += 1
            while self._serving != ticket:
                self._cond.wait()

    def release(self):
        with self._cond:
            self._serving += 1
            self._cond.notify_all()

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()


class Engine:
    """One engine process. Requests are sent and answered one at a time."""

    def __init__(self, argv: Sequence[str], timeout: float):
        self._argv = list(argv)
        self._timeout = timeout
        self._proc: subprocess.Popen | None = None
        self._lines: queue.Queue = queue.Queue()
        self._stderr_tail: list[bytes] = []
        self._next_id = 1

    # ----- process lifecycle -------------------------------------------------

    @property
    def pid(self) -> int | None:
        if self._proc is None or self._proc.poll() is not None:
            return None
        return self._proc.pid

    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    @staticmethod
    def _close_streams(proc) -> None:
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass

    def start(self) -> None:
        if self._proc is not None:
            self._close_streams(self._proc)
        self._proc = subprocess.Popen(
            self._argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        self._lines = queue.Queue()
        self._stderr_tail = []
        threading.Thread(target=self._read_stdout, args=(self._proc, self._lines), daemon=True).start()
        threading.Thread(target=self._drain_stderr, args=(self._proc,), daemon=True).start()

    def _read_stdout(self, proc, q):
        try:
            for raw in iter(proc.stdout.readline, b""):
                q.put(raw)
        except (OSError, ValueError):
            # stop() or kill() closed the stream while this thread was reading.
            pass
        finally:
            q.put(_EOF)

    def _drain_stderr(self, proc):
        try:
            for raw in iter(proc.stderr.readline, b""):
                self._stderr_tail.append(raw)
                del self._stderr_tail[:-20]
        except (OSError, ValueError):
            # The stream was closed by stop() or kill(); the tail so far is kept.
            pass

    def stop(self, graceful: bool, wait: float) -> None:
        proc = self._proc
        if proc is None:
            return
        if graceful and proc.poll() is None:
            try:
                self.request("shutdown", {}, timeout=wait)
            except IncrementalError:
                pass
            # The engine writes its index image before it exits. Let it finish.
            self.wait_exit(max(wait, 1.0))
        try:
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
        self._close_streams(proc)
        self._proc = None

    def wait_exit(self, timeout: float) -> int | None:
        """Wait for the process to exit and return its status (None if still running)."""
        if self._proc is None:
            return None
        try:
            return self._proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return None

    def kill(self) -> None:
        """Kill the process without a shutdown request. Used on timeout."""
        proc = self._proc
        if proc is None:
            return
        try:
            proc.kill()
            proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
        self._close_streams(proc)

    # ----- requests ----------------------------------------------------------

    def request(self, method: str, params: dict, timeout: float | None = None) -> Any:
        """Send one request and return its result. Raises IncrementalError."""
        req_id = self._next_id
        self._next_id += 1
        body = {"id": req_id, "method": method, "params": params}
        self._send_line(json.dumps(body, separators=(",", ":")).encode("utf-8") + b"\n")
        return self._await(req_id, self._timeout if timeout is None else timeout)

    def send_raw(self, line: bytes) -> None:
        """Write a raw line (used by protocol-level tests)."""
        self._send_line(line if line.endswith(b"\n") else line + b"\n")

    def read_response(self, timeout: float | None = None) -> dict:
        """Read the next response line, whatever its id."""
        return self._read_one(self._timeout if timeout is None else timeout)

    def _send_line(self, data: bytes) -> None:
        proc = self._proc
        if proc is None:
            raise IncrementalError("engine_exited", "engine is not running")
        try:
            proc.stdin.write(data)
            proc.stdin.flush()
        except OSError:
            # The engine is gone. Its error line, if any, is already queued
            # and _await reports it; otherwise the read sees EOF.
            pass

    def _await(self, req_id: int, timeout: float) -> Any:
        while True:
            msg = self._read_one(timeout)
            if msg.get("id") == req_id:
                if "error" in msg:
                    err = msg["error"]
                    raise IncrementalError(err.get("code", "internal"), err.get("message", ""), err.get("data"))
                if "result" not in msg:
                    raise IncrementalError("bad_response", f"response has neither result nor error: {msg!r}")
                return msg["result"]
            if msg.get("id") is None and msg.get("ok") is False and "error" in msg:
                err = msg["error"]
                raise IncrementalError(err.get("code", "internal"), err.get("message", ""), err.get("data"))
            # Any other line belongs to an earlier request and is dropped.

    def _read_one(self, timeout: float) -> dict:
        try:
            raw = self._lines.get(timeout=timeout)
        except queue.Empty:
            self.kill()
            raise IncrementalError("timeout", f"no response within {timeout} s", {"partial": False})
        if raw is _EOF:
            code = self._wait_exit()
            raise IncrementalError("engine_exited", f"engine exited (status {code})", self._stderr_text() or None)
        try:
            msg = json.loads(raw)
        except ValueError:
            raise IncrementalError("bad_response", f"engine wrote a line that is not JSON: {raw[:200]!r}")
        if not isinstance(msg, dict):
            raise IncrementalError("bad_response", f"engine wrote a non-object line: {raw[:200]!r}")
        return msg

    def _wait_exit(self):
        if self._proc is None:
            return None
        try:
            return self._proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            return None

    def _stderr_text(self) -> str:
        return b"".join(self._stderr_tail).decode("utf-8", "replace").strip()


def default_engine() -> str:
    env = os.environ.get("INCREMENTAL_ENGINE")
    if env:
        return env
    return os.path.join(find_repo_root(), "core", "dist", "incremental")


def default_store() -> str:
    env = os.environ.get("INCREMENTAL_STORE")
    if env:
        return env
    return os.path.join(find_repo_root(), ".incremental")


def find_repo_root(start: str | None = None) -> str:
    here = os.path.abspath(start or os.getcwd())
    cur = here
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return here
        cur = parent
