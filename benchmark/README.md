# SkillOpt offline evaluation

This benchmark tests the agent's *next decision* in fictitious literature-access situations. It does not test publisher availability or execute browser actions. The three splits are fixed so the test cases stay unseen during optimization.

Use a separate checkout of [Microsoft SkillOpt](https://github.com/microsoft/SkillOpt) installed in a Python environment. Run from this repository's root, using that environment's Python:

This adapter was exercised against SkillOpt commit `79124b3` and an authenticated Codex CLI. SkillOpt's custom-adapter API may change; review its current benchmark guide before upgrading.

```text
python -m benchmark.run_skillopt eval --out_root benchmark/outputs/baseline --split valid_unseen
python -m benchmark.run_skillopt train --out_root benchmark/outputs/train
python -m benchmark.run_skillopt eval --skill benchmark/outputs/train/best_skill.md --out_root benchmark/outputs/held_out --split valid_unseen
```

`benchmark/run_skillopt.py` registers the custom environment without modifying SkillOpt. It extracts the body of `SKILL.md` to an ignored local seed, preserving the frontmatter. Each target call receives that body and one scenario as text. The config uses an already-authenticated Codex CLI with read-only sandbox, no web search, and no network for target runs. Adjust model names and backend only in your local copy if needed. Inspect the per-case rollouts and keep an edit only when it fixes a confirmed failure without regressing held-out cases or violating browser, authorization, and verification rules. The test set is small and synthetic; it cannot establish live download success.

The score checks `action` and `status`, plus `route` only when the scenario identifies one. Some terminal states accept multiple route labels because the label may refer to the last attempted route or to no further route. The benchmark does not give the target the expected answers or the PDF-verification rule; that rule must come from the skill.

## 中文说明

这是供 SkillOpt 使用的离线决策评测。`train`、`val`、`test` 三组虚构场景分别用于生成修改、筛选修改、独立检查。运行时不会控制浏览器、下载文献或消耗科研通点数。请使用已登录的 Codex CLI 和单独安装的 SkillOpt 环境运行上面的命令；模型回复与评测记录只保存在本机输出目录，不应提交到仓库。

评测只检查下一步动作、状态和渠道，不能证明真实网站可访问或 PDF 一定能下载。若候选只改变标签写法，则不采纳；修复了确切失败且独立场景没有回退时，可在人工核对安全边界后采纳。
