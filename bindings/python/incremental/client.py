"""The incremental client: one engine process, protocol v1, snake_case methods."""

from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any

from ._transport import Engine, _FifoLock, default_engine, default_store, find_repo_root
from .errors import IncrementalError

PROTOCOL = 1
CLIENT_NAME = "incremental-python"
CLIENT_VERSION = "0.1.0"

# Methods that do not change the store. A call to one of these is retried once
# after the engine dies in flight. Mutating calls are never retried.
_READ_ONLY = frozenset({"baseline", "stats", "explain", "affected", "ping"})


class Incremental:
    """A connection to one engine serving one store. Calls are serialized."""

    protocol = PROTOCOL

    def __init__(
        self, argv_prefix: Sequence[str], store: str, root: str, timeout: float, restart: bool
    ):
        self._prefix = list(argv_prefix)
        self._store = store
        self._root = root
        self._timeout = timeout
        self._restart = restart
        self._lock = _FifoLock()
        self._closed = False
        self._hello: dict | None = None
        self._engine = Engine(self._argv(), timeout)
        try:
            self._start_engine()
        except BaseException:
            self._engine.stop(graceful=False, wait=0)
            raise

    def _argv(self) -> list[str]:
        return self._prefix + ["serve", "--store", self._store, "--root", self._root]

    # ----- lifecycle ---------------------------------------------------------

    def _start_engine(self) -> None:
        self._engine.start()
        self._hello = self._engine.request(
            "hello",
            {"protocol": PROTOCOL, "client": {"name": CLIENT_NAME, "version": CLIENT_VERSION}},
        )
        if self._hello.get("protocol") != PROTOCOL:
            self._engine.kill()
            raise IncrementalError(
                "protocol_mismatch",
                "engine speaks another protocol",
                {"supported": [self._hello.get("protocol")]},
            )

    @property
    def engine_pid(self) -> int | None:
        """Pid of the running engine process, or None if it is not running."""
        return self._engine.pid

    def _ensure_running(self) -> None:
        if self._engine.is_running():
            return
        if not self._restart:
            raise IncrementalError("engine_exited", "engine is not running and restart is off")
        self._start_engine()

    def _call(self, method: str, params: dict | None = None) -> Any:
        params = {} if params is None else params
        with self._lock:
            if self._closed:
                raise IncrementalError("closed", "client is closed")
            self._ensure_running()
            try:
                return self._engine.request(method, params)
            except IncrementalError as err:
                if err.code != "engine_exited" or not self._restart:
                    raise
                if method not in _READ_ONLY:
                    raise
                self._start_engine()
                return self._engine.request(method, params)

    def close(self) -> None:
        """Send shutdown, wait for the engine to exit. Safe to call twice."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._engine.stop(graceful=True, wait=self._timeout)

    def __enter__(self) -> Incremental:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ----- protocol methods --------------------------------------------------

    def hello(self) -> dict:
        return self._call(
            "hello",
            {"protocol": PROTOCOL, "client": {"name": CLIENT_NAME, "version": CLIENT_VERSION}},
        )

    def observe(self, observation: dict) -> dict:
        return self._call("observe", {"observation": observation})

    def observe_many(self, observations: list[dict]) -> dict:
        return self._call("observe_many", {"observations": list(observations)})

    def baseline(self) -> dict:
        return self._call("baseline")

    def advance(self, to: str, expected: str | None) -> dict:
        return self._call("advance", {"to": to, "expected": expected})

    def affected(
        self,
        changes: dict,
        *,
        baseline: str,
        context: dict | None = None,
        verify: bool = False,
        policy: str = "balanced",
        env: dict | None = None,
        config: dict | None = None,
        declared_tasks: list | None = None,
    ) -> dict:
        options: dict[str, Any] = {"baseline": baseline, "verify": verify, "policy": policy}
        if context is not None:
            options["context"] = context
        if env is not None:
            options["env"] = env
        if config is not None:
            options["config"] = config
        if declared_tasks is not None:
            options["declared_tasks"] = list(declared_tasks)
        return self._call("affected", {"changes": changes, "options": options})

    def explain(self, task: str) -> dict:
        return self._call("explain", {"task": task})

    def forget(self, task: str) -> dict:
        return self._call("forget", {"task": task})

    def stats(self) -> dict:
        return self._call("stats")

    def compact(self) -> dict:
        return self._call("compact")

    def ping(self) -> dict:
        return self._call("ping")


def connect(
    store: str | None = None,
    *,
    engine: str | Sequence[str] | None = None,
    root: str | None = None,
    timeout: float = 10.0,
    restart: bool = True,
) -> Incremental:
    """Start the engine for a store and return a connected client.

    store: store directory. Default: $INCREMENTAL_STORE, else <repo>/.incremental.
    engine: engine binary, or a command prefix. Default: $INCREMENTAL_ENGINE,
            else <repo>/core/dist/incremental.
    root: worktree root for verify. Default: <repo>.
    timeout: seconds per request. Default 10.
    restart: restart the engine when it dies. Default True.
    """
    repo = find_repo_root()
    store_dir = os.path.abspath(store) if store is not None else default_store()
    if engine is None:
        prefix = [default_engine()]
    elif isinstance(engine, str):
        prefix = [engine]
    else:
        prefix = list(engine)
    root_dir = os.path.abspath(root) if root is not None else repo
    return Incremental(prefix, store_dir, root_dir, timeout, restart)
