"""Test bootstrap — stub optional heavy imports when not installed in the test env."""

import sys
from unittest.mock import MagicMock

_OPTIONAL = ("dill",)
for _name in _OPTIONAL:
    if _name not in sys.modules:
        try:
            __import__(_name)
        except ImportError:
            sys.modules[_name] = MagicMock()
