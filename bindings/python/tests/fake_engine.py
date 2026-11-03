"""A stand-in engine for timeout tests. Answers hello, ping and baseline.
Never answers stats: it sleeps, so a client timeout is observed.
Answers hello with its pid in "store" so tests can see a restart.
Usage (by tests): python3 fake_engine.py serve --store X --root Y
"""

import json
import os
import sys
import time

MARKER = os.environ.get("FAKE_MARKER")  # if this file exists, the first ping kills the process

for raw in sys.stdin:
    try:
        req = json.loads(raw)
    except ValueError:
        continue
    method = req.get("method")
    rid = req.get("id")
    if method == "hello":
        out = {"id": rid, "result": {"protocol": 1, "engine": {"name": "fake", "version": "0"},
                                     "capabilities": [], "store": f"pid{os.getpid()}"}}
    elif method == "stats":
        time.sleep(30)
        continue
    elif method == "forget":
        os._exit(3)  # dies in flight: a mutating call must not be retried
    elif method == "ping" and MARKER and os.path.exists(MARKER):
        os.remove(MARKER)
        os._exit(9)  # dies in flight once: a read-only call is retried after restart
    elif method == "baseline":
        out = {"id": rid, "result": {"baseline": None}}
    elif method == "shutdown":
        sys.stdout.write(json.dumps({"id": rid, "result": {"bye": True}}) + "\n")
        sys.stdout.flush()
        break
    else:
        out = {"id": rid, "result": {"pong": True}}
    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()
