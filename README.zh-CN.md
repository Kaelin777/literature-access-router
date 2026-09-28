# 文献获取路由器（literature-access-router）

[English](README.md) · [Agent 规则](SKILL.md)

这是一个供 AI 助手执行的文献 PDF 获取 skill。首次使用时，每位用户只需建立自己的本地配置；之后助手按配置控制**用户已有且授权的** Chromium 浏览器会话，逐篇查找、下载并核验 PDF。机构、浏览器、保存目录、访问顺序及付费备用渠道均由用户配置，项目没有预设学校或订阅权限。

## 运行条件

- 支持 Codex 等能够读取 `SKILL.md` 并运行本地脚本的助手。
- Node.js 22+、Python 3，以及已安装的 Chrome、Edge 或 Chromium。
- 要通过浏览器获取登录后的全文，用户需自行开启其现有浏览器的 CDP 远程调试并完成浏览器授权。助手不会重启浏览器、修改个人资料或代替用户完成登录、双重验证、验证码。
- PDF 页数和首页标题/DOI 校验需要安装 `requirements.txt` 中的 Python 依赖。没有解析器时只能标为“未核实”，不能算成功下载。

## 安装与一次配置

将整个目录放入助手的 skill 目录，例如 `~/.codex/skills/literature-access-router/`。不要复制 `.venv` 或其他人的 `profile.json`。在本目录建立 Python 虚拟环境并安装依赖：

```text
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Windows 将上一条中的 `.venv/bin/python` 改为 `.venv\Scripts\python.exe`。若 Python 环境不在本目录，设置环境变量 `LIT_DL_PYTHON` 指向该解释器。

仅用开放获取资源的示例：

```text
python scripts/configure_profile.py init --browser chrome --output-dir <PDF绝对目录>
python scripts/configure_profile.py check
```

有机构访问权限的示例，请换成**本人确认**的名称和入口，不要从域名猜测机构：

```text
python scripts/configure_profile.py init --browser edge --output-dir <PDF绝对目录> --institution-name <机构全名> --resource-url <图书馆入口URL> --access-order institution,open_access
python scripts/configure_profile.py check
```

配置保存在用户机器的 `~/.config/lit-dl/profile.json`，也可通过 `LIT_DL_CONFIG_DIR` 指定配置目录。配置文件不在此仓库中，且不应包含密码、Cookie、令牌或浏览器配置文件。更多选项及浏览器准备过程见[配置说明](references/setup.md)。

## 日常使用

向助手提供 DOI、准确标题、PMID、arXiv ID 或文章链接，也可以提供列表。助手按 `access.order` 尝试用户已有的机构访问和合法开放获取来源；每批最多处理配置的 `batch.size` 篇，逐篇检查 PDF 文件头、页数及首页标题/DOI，并报告下载结果与待处理障碍。

若保存的 `.pdf` 实际是 HTML，助手会标记“未核实”，并在来源已知时注明渠道。用户仅询问下载状态时，会先报告这次失败的结果，再考虑是否尝试其他渠道。

需要登录或遇到验证码时，由用户在原浏览器中处理，助手保留相关标签页。站点拒绝访问、订阅不足或浏览器自动化被拦截时，不能保证全自动获取。skill 不绕过付费墙、DRM、验证码或机构验证。

AbleSci（科研通）仅为可选备用渠道。默认关闭；只有用户在本地配置中启用自动请求、明确设置每篇奖励点数及每次运行的总点数上限（或明确选择不限额）后，助手才可自动提交请求。请求和后续下载仍需用户自己的登录状态，且所有取得的文件都要核验。详见[可选工作流](references/ablesci-literature-request.md)。

## 规则评测

[`benchmark/`](benchmark/README.md) 提供可复现的 SkillOpt 离线评测，检查助手在虚构的首次配置、访问路由、登录障碍、备用请求和 PDF 核验场景中如何选择下一步。评测不会打开浏览器、下载论文或消耗点数。它只能检验规则决策的一致性；实际下载仍需在用户授权的浏览器会话中另行验证。

## 发布内容与隐私

仓库只包含 skill 指令、脚本、示例、规则及测试。个人机构配置、下载的论文、浏览器会话、登录凭据和虚拟环境应留在本机。使用本仓库时，请遵守资源提供方的许可及所在机构的使用条款。
