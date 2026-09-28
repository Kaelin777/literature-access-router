"""Offline SkillOpt benchmark for literature-access decisions.

This module never opens a browser, downloads a paper, or submits a request.
Only the skill body is optimized; the public SKILL.md frontmatter stays fixed.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from skillopt.datasets.base import BatchSpec, SplitDataLoader
from skillopt.envs.base import EnvAdapter
from skillopt.model import azure_openai, is_target_exec_backend, chat_target
from skillopt.model.codex_harness import run_target_exec


FIELDS = ("action", "status", "route")
TASK_RULES = """This is an offline decision test. All facts are included in this prompt.
Do not use tools, browse, download, edit files, operate a browser, submit requests, or spend points.
Use the supplied scenario as observed facts. Return exactly one JSON object, without prose or Markdown.
Keys: action, status, route.
Allowed action values: configure_profile, try_institution, try_open_access, wait_for_browser,
wait_for_auth, inspect_browser, verify_pdf, mark_downloaded, mark_unverified,
submit_fallback_request, report_unavailable, reuse_existing, split_batch.
Allowed status values: needs_setup, in_progress, needs_user, downloaded, unverified,
requested, unavailable.
Allowed route values: none, institution, open_access, fallback.
Choose the next action for the single paper or batch in the scenario.
"""


class LitDlLoader(SplitDataLoader):
    pass


def _parse_answer(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def score_answer(answer: str, expected: dict) -> tuple[int, float, dict]:
    parsed = _parse_answer(answer)
    scored_fields = [key for key in FIELDS if key in expected]
    if not scored_fields:
        raise ValueError("Every benchmark case needs at least one expected field")
    matches = [
        parsed.get(key) in expected[key] if isinstance(expected[key], list)
        else parsed.get(key) == expected[key]
        for key in scored_fields
    ]
    return int(all(matches)), sum(matches) / len(scored_fields), parsed


class LitDlAdapter(EnvAdapter):
    def __init__(
        self,
        split_dir: str = "",
        split_mode: str = "split_dir",
        seed: int = 42,
        limit: int = 0,
        workers: int = 1,
        analyst_workers: int = 1,
        failure_only: bool = True,
        minibatch_size: int = 3,
        edit_budget: int = 2,
        exec_timeout: int = 120,
    ) -> None:
        self.workers = workers
        self.analyst_workers = analyst_workers
        self.failure_only = failure_only
        self.minibatch_size = minibatch_size
        self.edit_budget = edit_budget
        self.exec_timeout = exec_timeout
        self.dataloader = LitDlLoader(split_dir=split_dir, split_mode=split_mode, seed=seed, limit=limit)

    def setup(self, cfg: dict) -> None:
        super().setup(cfg)
        self.dataloader.setup(cfg)

    def get_dataloader(self):
        return self.dataloader

    def build_env_from_batch(self, batch: BatchSpec, **kwargs):
        return list(batch.payload or [])

    def build_train_env(self, batch_size: int, seed: int, **kwargs):
        return self.build_env_from_batch(self.dataloader.build_train_batch(batch_size=batch_size, seed=seed, **kwargs))

    def build_eval_env(self, env_num: int, split: str, seed: int, **kwargs):
        return self.build_env_from_batch(self.dataloader.build_eval_batch(env_num=env_num, split=split, seed=seed, **kwargs))

    def rollout(self, env_manager, skill_content: str, out_dir: str, **kwargs) -> list[dict]:
        results = []
        for item in env_manager:
            case_id = str(item["id"])
            case_dir = Path(out_dir, "predictions", case_id)
            case_dir.mkdir(parents=True, exist_ok=True)
            user = TASK_RULES + "\nScenario:\n" + json.dumps(item["scenario"], ensure_ascii=False, indent=2)
            if is_target_exec_backend():
                work_dir = case_dir / "codex_exec"
                work_dir.mkdir(exist_ok=True)
                prompt = (
                    "This is an offline text-only evaluation. Apply the following skill guidance "
                    "to the scenario. No tools or files are needed. Return only the requested JSON.\n\n"
                    f"SKILL GUIDANCE:\n{skill_content}\n\nTASK:\n{user}"
                )
                answer, _raw = run_target_exec(
                    work_dir=str(work_dir),
                    prompt=prompt,
                    model=azure_openai.TARGET_DEPLOYMENT,
                    timeout=self.exec_timeout,
                )
            else:
                answer, _usage = chat_target(system=skill_content, user=user, max_completion_tokens=400)
            hard, soft, parsed = score_answer(answer, item["expected"])
            feedback = {"expected": item["expected"], "parsed": parsed, "hard": hard, "soft": soft}
            conversation = [
                {"role": "system", "content": skill_content},
                {"role": "user", "content": user},
                {"role": "assistant", "content": answer},
                {"role": "system", "content": "[EVALUATION RESULT] " + json.dumps(feedback, ensure_ascii=False)},
            ]
            (case_dir / "conversation.json").write_text(json.dumps(conversation, ensure_ascii=False, indent=2), encoding="utf-8")
            results.append({
                "id": case_id,
                "hard": hard,
                "soft": soft,
                "predicted_answer": answer,
                "task_description": json.dumps(item["scenario"], ensure_ascii=False),
                "question": user,
                "reference_text": json.dumps(item["expected"], ensure_ascii=False),
                "task_type": item.get("task_type", "routing"),
                "target_system_prompt": skill_content,
                "target_user_prompt": user,
                "n_turns": 1,
                "fail_reason": "expected " + json.dumps(item["expected"], ensure_ascii=False) if not hard else "",
            })
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        Path(out_dir, "rollouts.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        return results

    def get_task_types(self) -> list[str]:
        return sorted({str(item.get("task_type", "routing")) for item in (
            self.dataloader.train_items + self.dataloader.val_items + self.dataloader.test_items
        )})
