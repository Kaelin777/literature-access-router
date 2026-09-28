# literature-access-router

[简体中文说明](README.zh-CN.md)

Portable literature download skill for an existing, user-authorized Chromium browser. The skill contains no default institution, browser, output path, paid service, or reward amount.

On first use, create `~/.config/lit-dl/profile.json` with `scripts/configure_profile.py init ...` using Python 3 (`python.cmd` on Windows when using the skill's environment), then run `check`. See [`references/setup.md`](references/setup.md) for the fields, dependencies, and browser readiness sequence. The profile is local to the user and should not be copied with the skill. Legacy `school.json` remains untouched.

For each paper, follow the profile's access order, verify the PDF bytes and title/DOI, and report unresolved login or publisher blockers. AbleSci requests are optional and require an explicit user-configured point cap. See [`SKILL.md`](SKILL.md) for agent instructions.
