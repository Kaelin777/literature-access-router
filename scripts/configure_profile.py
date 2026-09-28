#!/usr/bin/env python3
"""Create and validate a portable literature-access profile without touching browsers.

The old school.json remains readable by older scripts. New users configure
profile.json; no institution, subscription, or login state is inferred from a URL.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit


CONFIG_DIR = Path(os.environ.get("LIT_DL_CONFIG_DIR", Path.home() / ".config" / "lit-dl"))
PROFILE_FILE = CONFIG_DIR / "profile.json"
LEGACY_FILE = CONFIG_DIR / "school.json"
SENSITIVE_QUERY_KEYS = {"access_token", "code", "id_token", "key", "password", "session", "token"}


def _safe_url(value: str | None, label: str) -> None:
    if value is None:
        return
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a URL string or null")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{label} must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError(f"{label} must not contain credentials or a fragment")
    if any(key.lower() in SENSITIVE_QUERY_KEYS for key, _ in parse_qsl(parsed.query)):
        raise ValueError(f"{label} appears to contain a secret-bearing query parameter")


def validate_profile(profile: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(profile, dict):
        return ["profile must be a JSON object"]
    if profile.get("version") != 2:
        errors.append("version must be 2")
    allowed = {"version", "browser", "access", "output", "challenge", "fallback", "batch"}
    if set(profile) - allowed:
        errors.append("profile contains unsupported top-level fields")
    for section in ("browser", "access", "output", "challenge", "fallback", "batch"):
        if not isinstance(profile.get(section), dict):
            errors.append(f"{section} must be an object")
    if errors:
        return errors
    browser = profile["browser"]
    access = profile["access"]
    output = profile["output"]
    challenge = profile["challenge"]
    fallback = profile["fallback"]
    batch = profile["batch"]
    section_keys = {
        "browser": {"engine", "control_url", "devtools_file"},
        "access": {"order", "institution", "discovery_url", "cnki_url"},
        "output": {"directory"},
        "challenge": {"on_new"},
        "fallback": {"provider", "auto_request", "reward_points", "max_points_per_run"},
        "batch": {"size"},
    }
    for name, expected in section_keys.items():
        if set(profile[name]) - expected:
            errors.append(f"{name} contains unsupported fields")
    if browser.get("engine") not in {"chrome", "edge", "chromium"}:
        errors.append("browser.engine must be chrome, edge, or chromium")
    control_url = browser.get("control_url")
    try:
        parsed = urlsplit(control_url or "")
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or not parsed.port or parsed.path not in {"", "/"}:
            errors.append("browser.control_url must be a loopback HTTP URL with a port")
    except (TypeError, ValueError):
        errors.append("browser.control_url has an invalid port")
    order = access.get("order")
    if not isinstance(order, list) or not order or any(not isinstance(x, str) or x not in {"institution", "open_access"} for x in order) or len(order) != len(set(order)):
        errors.append("access.order must contain unique institution/open_access routes")
    elif "open_access" not in order:
        errors.append("access.order must include open_access before any paid fallback")
    institution = access.get("institution")
    if institution is None:
        if isinstance(order, list) and "institution" in order:
            errors.append("access.order cannot include institution without an institution profile")
    elif not isinstance(institution, dict) or not str(institution.get("name") or "").strip():
        errors.append("access.institution needs a confirmed name")
    else:
        if set(institution) - {"name", "entry_url", "auth_hint"}:
            errors.append("access.institution contains unsupported fields")
        try:
            _safe_url(institution.get("entry_url"), "access.institution.entry_url")
        except ValueError as exc:
            errors.append(str(exc))
    try:
        _safe_url(access.get("discovery_url"), "access.discovery_url")
    except ValueError as exc:
        errors.append(str(exc))
    try:
        _safe_url(access.get("cnki_url"), "access.cnki_url")
    except ValueError as exc:
        errors.append(str(exc))
    directory = output.get("directory")
    if not isinstance(directory, str) or not Path(directory).expanduser().is_absolute():
        errors.append("output.directory must be an absolute path")
    if challenge.get("on_new") not in {"wait_for_user", "skip_paper"}:
        errors.append("challenge.on_new must be wait_for_user or skip_paper")
    provider = fallback.get("provider")
    auto_request = fallback.get("auto_request")
    points = fallback.get("reward_points")
    maximum = fallback.get("max_points_per_run")
    if provider not in {"none", "ablesci"} or not isinstance(auto_request, bool):
        errors.append("fallback.provider/auto_request is invalid")
    if maximum is not None and (not isinstance(maximum, int) or isinstance(maximum, bool) or maximum < 0):
        errors.append("fallback.max_points_per_run must be a nonnegative integer or explicit null")
    if points is not None and (not isinstance(points, int) or isinstance(points, bool) or points < 1):
        errors.append("fallback.reward_points must be a positive integer or null")
    if auto_request and (provider != "ablesci" or points is None or (maximum is not None and maximum < points)):
        errors.append("automatic AbleSci requests need explicit reward_points and a sufficient cap or unlimited opt-in")
    if provider == "none" and (auto_request or points is not None or maximum != 0):
        errors.append("fallback=none cannot reserve or spend points")
    size = batch.get("size")
    if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 10:
        errors.append("batch.size must be from 1 to 10")
    return errors


def make_profile(args: argparse.Namespace) -> dict:
    if args.resource_url and not args.institution_name:
        raise ValueError("--resource-url requires --institution-name; the URL does not identify an institution")
    if args.institution_name and not args.institution_name.strip():
        raise ValueError("--institution-name cannot be blank")
    if args.unlimited_points and args.max_points_per_run != 0:
        raise ValueError("--unlimited-points cannot be combined with --max-points-per-run")
    if args.unlimited_points and (args.fallback != "ablesci" or not args.auto_request):
        raise ValueError("--unlimited-points requires automatic AbleSci requests")
    institution = None
    if args.institution_name:
        institution = {
            "name": args.institution_name.strip(),
            "entry_url": args.resource_url,
            "auth_hint": args.auth_hint,
        }
    order = [part.strip() for part in args.access_order.split(",")] if args.access_order else (
        ["institution", "open_access"] if institution else ["open_access"]
    )
    profile = {
        "version": 2,
        "browser": {
            "engine": args.browser,
            "control_url": args.control_url.rstrip("/"),
            "devtools_file": args.devtools_file,
        },
        "access": {
            "order": order,
            "institution": institution,
            "discovery_url": args.discovery_url,
            "cnki_url": args.cnki_url,
        },
        "output": {"directory": str(Path(args.output_dir).expanduser().resolve())},
        "challenge": {"on_new": args.on_challenge},
        "fallback": {
            "provider": args.fallback,
            "auto_request": args.auto_request,
            "reward_points": args.reward_points,
            "max_points_per_run": None if args.unlimited_points else args.max_points_per_run,
        },
        "batch": {"size": args.batch_size},
    }
    errors = validate_profile(profile)
    if errors:
        raise ValueError("; ".join(errors))
    return profile


def cmd_init(args: argparse.Namespace) -> int:
    profile = make_profile(args)
    if PROFILE_FILE.exists() and not args.replace:
        raise ValueError(f"{PROFILE_FILE} already exists; use --replace after review")
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if PROFILE_FILE.exists():
        backup = PROFILE_FILE.with_name(f"profile.{datetime.now():%Y%m%d_%H%M%S}.json.bak")
        shutil.copy2(PROFILE_FILE, backup)
    temp = PROFILE_FILE.with_suffix(".json.tmp")
    temp.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temp, 0o600)
    temp.replace(PROFILE_FILE)
    print(json.dumps({"ok": True, "path": str(PROFILE_FILE), "institution_configured": bool(profile["access"]["institution"]), "fallback": profile["fallback"]["provider"]}, ensure_ascii=False))
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    if not PROFILE_FILE.exists():
        print(json.dumps({"ok": False, "path": str(PROFILE_FILE), "legacy_school_config_present": LEGACY_FILE.exists(), "errors": ["profile.json not found"]}, ensure_ascii=False))
        return 2
    try:
        profile = json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "errors": [str(exc)]}, ensure_ascii=False))
        return 1
    errors = validate_profile(profile)
    result = {"ok": not errors, "path": str(PROFILE_FILE), "errors": errors}
    if args.show and not errors:
        result["profile"] = profile
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Configure portable literature access. Does not open a browser or log in.")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="Create a per-user profile")
    init.add_argument("--browser", required=True, choices=["chrome", "edge", "chromium"])
    init.add_argument("--output-dir", required=True)
    init.add_argument("--institution-name", help="Exact institution chosen by the user; omit for OA-only access")
    init.add_argument("--resource-url", help="Institution library entry URL; never used to guess institution/subscriptions")
    init.add_argument("--auth-hint", help="Optional user-confirmed SSO/CARSI/OpenAthens note")
    init.add_argument("--access-order", help="Comma-separated institution,open_access or open_access,institution")
    init.add_argument("--discovery-url", help="Optional user-confirmed search/database entry URL")
    init.add_argument("--cnki-url", help="Optional user-confirmed CNKI search entry URL")
    init.add_argument("--control-url", default="http://127.0.0.1:3461")
    init.add_argument("--devtools-file", help="Existing browser DevToolsActivePort path when not auto-detected")
    init.add_argument("--on-challenge", choices=["wait_for_user", "skip_paper"], default="wait_for_user")
    init.add_argument("--fallback", choices=["none", "ablesci"], default="none")
    init.add_argument("--auto-request", action="store_true", help="Allow automatic requests within the configured point cap")
    init.add_argument("--reward-points", type=int)
    init.add_argument("--max-points-per-run", type=int, default=0)
    init.add_argument("--unlimited-points", action="store_true", help="Explicitly allow unlimited automatic request points; use only when the user authorizes it")
    init.add_argument("--batch-size", type=int, default=10)
    init.add_argument("--replace", action="store_true", help="Back up and replace an existing profile")
    init.set_defaults(func=cmd_init)
    check = sub.add_parser("check", help="Validate profile.json without browser/network access")
    check.add_argument("--show", action="store_true", help="Show nonsecret profile contents")
    check.set_defaults(func=cmd_check)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
