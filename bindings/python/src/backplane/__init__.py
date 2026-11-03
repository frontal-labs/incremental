"""Python client for the backplane incremental dependency engine (protocol v1).

Spec: spec/bindings-python.md. Standard library only.
"""

from .client import Backplane, connect
from .errors import BackplaneError

__all__ = ["Backplane", "BackplaneError", "connect", "__version__"]
__version__ = "0.1.0"
