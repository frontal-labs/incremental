"""Python client for the incremental incremental dependency engine (protocol v1).

Spec: spec/bindings-python.md. Standard library only.
"""

from .client import Incremental, connect
from .errors import IncrementalError

__all__ = ["Incremental", "IncrementalError", "connect", "__version__"]
__version__ = "0.1.0"
