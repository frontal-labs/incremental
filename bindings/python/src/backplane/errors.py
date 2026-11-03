"""Errors raised by the backplane client."""

from typing import Any


class BackplaneError(Exception):
    """A protocol error from the engine, or a client-side failure.

    code: a protocol error code (spec/PROTOCOL.md) or one of the client codes
          timeout, engine_exited, closed, bad_response.
    message: human-readable text from the engine or the client.
    data: the engine's error.data, a dict, or None.
    """

    def __init__(self, code: str, message: str, data: Any = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.data = data

    def __reduce__(self):
        return (BackplaneError, (self.code, self.message, self.data))
