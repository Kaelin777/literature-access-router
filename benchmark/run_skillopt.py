"""Register this benchmark without modifying the Microsoft SkillOpt checkout."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import scripts.eval_only as eval_only
import scripts.train as train

from benchmark.skillopt_litdl import LitDlAdapter


ROOT = Path(__file__).resolve().parents[1]


def skill_body() -> str:
    text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end >= 0:
            return text[end + 5 :].lstrip()
    raise ValueError("SKILL.md must retain a YAML frontmatter block")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("train", "eval"))
    args, rest = parser.parse_known_args()
    generated = ROOT / "benchmark" / ".seed_body.md"
    generated.write_text(skill_body(), encoding="utf-8")
    sys.argv = [sys.argv[0], "--config", str(ROOT / "benchmark" / "config.yaml"), *rest]
    if args.mode == "train":
        train._ENV_REGISTRY["literature_access"] = LitDlAdapter
        sys.argv.extend(["--skill_init", str(generated)])
        train.main()
    else:
        eval_only._ENV_REGISTRY["literature_access"] = LitDlAdapter
        if "--skill" not in rest:
            sys.argv.extend(["--skill", str(generated)])
        eval_only.main()


if __name__ == "__main__":
    main()
