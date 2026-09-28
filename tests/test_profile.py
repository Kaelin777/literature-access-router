"""Offline checks for portable setup decisions; no browser or network use."""

from __future__ import annotations

import sys
import unittest
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from configure_profile import make_profile, validate_profile  # noqa: E402


BASE = dict(
    browser="chrome",
    control_url="http://127.0.0.1:3461",
    devtools_file=None,
    output_dir=str(Path(__file__).resolve().parents[1]),
    institution_name=None,
    resource_url=None,
    auth_hint=None,
    access_order=None,
    discovery_url=None,
    cnki_url=None,
    on_challenge="wait_for_user",
    fallback="none",
    auto_request=False,
    reward_points=None,
    max_points_per_run=0,
    unlimited_points=False,
    batch_size=10,
)


class PortableProfileTests(unittest.TestCase):
    def make(self, **overrides):
        return make_profile(Namespace(**(BASE | overrides)))

    def test_no_institution_is_valid_and_oa_only(self):
        profile = self.make()
        self.assertEqual(profile["access"]["order"], ["open_access"])
        self.assertIsNone(profile["access"]["institution"])
        self.assertEqual(validate_profile(profile), [])

    def test_resource_url_cannot_invent_institution_or_subscription(self):
        with self.assertRaises(ValueError):
            self.make(resource_url="https://library.example.edu/resources")
        profile = self.make(institution_name="Example University", resource_url="https://library.example.edu/resources")
        self.assertEqual(profile["access"]["institution"]["name"], "Example University")
        self.assertNotIn("libraries", profile)

    def test_paid_requests_require_explicit_budget_decision(self):
        with self.assertRaises(ValueError):
            self.make(fallback="ablesci", auto_request=True, reward_points=10, max_points_per_run=5)
        capped = self.make(fallback="ablesci", auto_request=True, reward_points=10, max_points_per_run=20)
        self.assertEqual(capped["fallback"]["max_points_per_run"], 20)
        unlimited = self.make(fallback="ablesci", auto_request=True, reward_points=10, unlimited_points=True)
        self.assertIsNone(unlimited["fallback"]["max_points_per_run"])

    def test_secret_bearing_url_is_rejected(self):
        with self.assertRaises(ValueError):
            self.make(institution_name="Example University", resource_url="https://library.example.edu/?token=secret")

    def test_open_access_cannot_be_omitted_before_fallback(self):
        with self.assertRaises(ValueError):
            self.make(institution_name="Example University", access_order="institution")


if __name__ == "__main__":
    unittest.main()
