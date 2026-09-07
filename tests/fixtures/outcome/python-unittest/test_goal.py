import pathlib
import unittest

class GoalTest(unittest.TestCase):
    def test_heading(self):
        self.assertIn('New heading', pathlib.Path('README.md').read_text())
