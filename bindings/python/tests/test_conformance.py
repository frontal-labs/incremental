"""Every case in conformance/cases/*.json, run through the Python client."""

import glob
import os
import unittest

from . import _support as S
from ._conformance import run_case


def _make_test(path: str):
    case = S.load_case(path)

    def test(self):
        S.require_engine()
        diffs = run_case(case)
        self.assertEqual(diffs, [], f"{case['id']} {case['desc']}")

    test.__doc__ = case["desc"]
    return case["id"], test


class TestConformance(unittest.TestCase):
    pass


for _path in sorted(glob.glob(os.path.join(S.CASES_DIR, "*.json"))):
    _name, _fn = _make_test(_path)
    setattr(TestConformance, f"test_{_name}", _fn)
