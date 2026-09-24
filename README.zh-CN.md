<div align="center">

# model-bump

**把模型换成 Claude Opus 5.5，你的代码还能跑吗？**

在上线之前，一条命令找出你的代码、依赖，以及**框架实际发出的请求**里，哪些地方会被 Opus 5.5 的破坏性变更影响。

不需要 API Key，不需要安装，数据不出本机。

[English](README.md) · [简体中文](README.zh-CN.md)

<img src="docs/check.svg" alt="model-bump check 输出" width="820">

</div>

```bash
# 1. 静态扫描：代码和锁文件
npx github:qiwei66/model-bump check .

# 2. 让你的应用连上一个本地的"假 Opus 5.5"，它会拒绝所有真 Opus 5.5 会拒绝的请求
npx github:qiwei66/model-bump probe -- python app.py
```

## 为什么需要它

[Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide) 的单价更低（每百万 token $4 / $20，之前是 $5 / $25），大家都想马上换。但它也带来了这些变化：

| 变化 | 只换模型 ID 会怎样 |
|---|---|
| thinking 无法关闭 | `thinking: {type: "disabled"}` → **400**，`budget_tokens` → **400** |
| 不再支持强制调用工具 | `tool_choice: {type: "any" \| "tool"}` → **400** |
| 响应的第一个块是 `thinking` | `response.content[0].text` → **报错，或者拿到空字符串** |
| thinking 块和对话绑定 | 工具调用循环里把 thinking 块过滤掉 → **400** |
| 采样参数被移除 | `temperature=0` → **400** |
| effort 默认值变了 | 从 `high` 变成 `medium`，同名档位对应的思考预算也不一样 |
| computer use 工具换代 | 在 Claude API 和 Google Cloud 上，`computer_20251124` → **400** |

这些问题大多不在**你自己写的代码**里，而在你和 API 之间的那层框架里。所以我们把主流框架接到 model-bump 的"假 Opus 5.5"上，看它们实际发出去的是什么：

| 技术栈（2026-09-24 实测） | 在 `claude-opus-5-5` 上的表现 |
|---|---|
| `anthropic` Python 1.8.0 | `resp.content[0].text` → `AttributeError: 'ThinkingBlock' object has no attribute 'text'` |
| `langchain-anthropic` **1.7.3 和 1.7.4** | `bind_tools(tool_choice="any")`、`thinking={"type":"disabled"}`、`temperature=0` 都被原样发出 → **400**。`with_structured_output()` 不再强制调用工具，模型一旦用文本回答就抛 `OutputParserException` |
| `litellm` 1.102.1 | 强制 `tool_choice` 或设置 `temperature` → `UnsupportedParamsError`。开了 `drop_params=True` 后，强制调用会被**悄悄降级成 `auto`**。`response_format` 走的是已弃用的 `output_format` |
| `ai` 7.0.113 + `@ai-sdk/anthropic` 4.0.62 | `toolChoice: "required"` 被降级成 `auto` 并给出警告；模型没调用工具时抛 `ToolChoiceViolationError` |
| 手写的工具调用循环（任何 SDK） | 回传工具结果前执行 `content.filter(b => b.type !== "thinking")` → **400** |

<!-- SURVEY -->

## `check`：静态扫描

```bash
npx github:qiwei66/model-bump check [path] [--skip-tests] [--json] [--fail-on error|warn|never]
```

- **代码**：Python、TypeScript/JavaScript、Notebook（`.ipynb`）、Java/Kotlin、Go、Ruby、PHP、C#。
- **依赖**：读取 `requirements*.txt`、`pyproject.toml`、`poetry.lock`、`uv.lock`、`Pipfile.lock`、`package.json`、`package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`，并对照[已知有问题的框架版本表](src/rules/deps.js)。
- 列出所有需要替换的旧 Claude 模型 ID。
- 某一行不想被检查时，在那行加上 `model-bump-ignore` 注释。

## `probe`：给你的真实应用配一个"假 Opus 5.5"

```bash
npx github:qiwei66/model-bump probe -- python app.py
npx github:qiwei66/model-bump probe -- npm test
npx github:qiwei66/model-bump probe --serve        # 然后自己设置 ANTHROPIC_BASE_URL
```

- **拒绝**所有 Opus 5.5 会拒绝的请求，返回同样格式的 400（文档里给出了原文的报错会一字不差），这样你的错误处理也能真正跑一遍。
- 其余请求按 Opus 5.5 的方式**回答**：先给一个 `thinking` 块，再给文本，也支持流式输出（SSE）。读取 `content[0].text` 的代码在这里会像在生产环境一样报错。
- 加上 `--simulate-tools`，模拟响应会调用你的第一个工具，然后检查你的循环有没有把 `thinking` 块原样传回去。
- 会自动为子进程设置 `ANTHROPIC_BASE_URL`（官方 SDK、Vercel AI SDK、Agent SDK）、`ANTHROPIC_API_URL`（LangChain）、`ANTHROPIC_API_BASE`（LiteLLM），并填一个假的 API Key，完全用不到你的真 Key。
- `--lenient` 模式下违规请求也返回 200，一次运行就能找出所有问题。`--dump dir/` 会把抓到的请求保存下来。

不管你现在用的是哪个模型 ID，probe 都**按发给 Opus 5.5 的标准**校验每一个请求。先 probe，再换模型。

> Bedrock、Vertex、Foundry 的客户端不读 `ANTHROPIC_BASE_URL`。probe 时请把应用切到 Anthropic provider。

## 接入 CI

```yaml
# .github/workflows/model-bump.yml
on: [pull_request]
jobs:
  model-bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: qiwei66/model-bump@main
        with:
          fail-on: error
          args: --skip-tests
```

发现的问题会以行内注释的形式显示在 PR 的代码 diff 上。

## 常见问题

**和 `/claude-api migrate` 有什么区别？** Anthropic 官方的 skill 在 Claude Code 里帮你改**你自己的代码**，非常好用。model-bump 检查的是它看不到的部分：依赖版本，以及框架在运行时实际拼出来的请求。它还能跑在 CI 里，不需要 Claude Code，也不需要 API Key。两者可以一起用。

**会调用 Anthropic 的接口吗？** 不会，两个命令都完全在本地运行。

**是官方项目吗？** 不是。这是一个独立的开源项目，与 Anthropic 没有关联。

**某个框架已经修好了，表格过时了怎么办？** 欢迎直接给 [`src/rules/deps.js`](src/rules/deps.js) 提 PR。

---

如果 model-bump 帮你挡住了一次线上 400，点个 ⭐ 能让更多人找到它。
