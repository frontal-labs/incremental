"""Errors raised by the incremental client."""

from typing import Any


class IncrementalError(Exception):
    """A protocol error from the engine, or a client-side failure.

    code: a protocol error code (docs/spec/PROTOCOL.md) or one of the client codes
          timeout, engine_exited, closed, bad_response.
    message: human-readable text from the engine or the client.
    data: the engine's error.data, a dict, or None.
    """

    def __init__(self, code: str, message: str, data: Any = None):
        """Build the error from the engine's code, message and optional data."""
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.data = data

    def __reduce__(self):
        """Support pickling by rebuilding the error from its fields."""
        return (IncrementalError, (self.code, self.message, self.data))
