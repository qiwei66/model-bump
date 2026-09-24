# Survey: 39 open-source AI repos vs. Claude Opus 5.5

Run on 2026-09-24 with `model-bump check --skip-tests` (v0.1.0) on a shallow clone of each repo's default branch.
Each row lists the commit that was scanned, so you can reproduce it.

**How to read this.** A finding is a code path that the API rejects (or misreads) *if that path runs against `claude-opus-5-5`*.
Many of these projects are multi-model routers that gate parameters by model. For those, what matters is whether their
model tables already know about Opus 5.5. None of this means a project is broken today.

| repo | commit | `content[0].text` on a response | `budget_tokens` | forced `tool_choice` | `thinking` disabled | legacy computer use | deps |
|---|---|---:|---:|---:|---:|---:|---|
| [567-labs/instructor](https://github.com/567-labs/instructor) | `e12f8b4` | · | · | 1 | · | · | litellm |
| [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code) | `d026163` | · | 1 | · | · | · | · |
| [ag2ai/ag2](https://github.com/ag2ai/ag2) | `e3cd417` | · | · | · | · | · | · |
| [agno-agi/agno](https://github.com/agno-agi/agno) | `bdd7c96` | · | 7 | · | · | · | litellm |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | `5dc9490` | · | 3 | · | · | · | litellm |
| [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands) | `fad39b8` | · | · | · | · | · | · |
| [anthropics/anthropic-cookbook](https://github.com/anthropics/anthropic-cookbook) | `a4b0d89` | 46 | 17 | 3 | · | · | · |
| [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts) | `8e946ff` | 1 | 1 | 1 | 1 | 4 | @ai-sdk/anthropic |
| [anthropics/courses](https://github.com/anthropics/courses) | `f4dbb13` | 57 | · | 6 | · | · | · |
| [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | `6f99857` | · | · | · | · | · | deepagents, litellm |
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | `1c8a0ff` | · | 58 | 2 | · | 1 | litellm |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | `d8110c5` | · | 2 | · | · | · | · |
| [camel-ai/camel](https://github.com/camel-ai/camel) | `fc27907` | · | 1 | · | · | · | litellm |
| [cline/cline](https://github.com/cline/cline) | `b51c27b` | · | 68 | · | 1 | · | @ai-sdk/amazon-bedrock |
| [continuedev/continue](https://github.com/continuedev/continue) | `5522c6f` | 2 | 2 | · | · | · | @ai-sdk/anthropic |
| [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | `7060bf8` | · | 1 | · | · | · | litellm |
| [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) | `f13b0ea` | 1 | 17 | · | 4 | · | · |
| [Doriandarko/claude-engineer](https://github.com/Doriandarko/claude-engineer) | `0a9e4b3` | 7 | · | · | · | · | · |
| [e2b-dev/E2B](https://github.com/e2b-dev/E2B) | `ccaf9fc` | · | · | · | · | · | · |
| [geekan/MetaGPT](https://github.com/geekan/MetaGPT) | `11cdf46` | 1 | 2 | · | · | · | · |
| [getzep/graphiti](https://github.com/getzep/graphiti) | `1980db2` | · | · | 1 | · | · | langchain-anthropic, langchain-aws |
| [huggingface/smolagents](https://github.com/huggingface/smolagents) | `227ef5e` | 2 | · | · | · | · | litellm |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) | `99abe67` | · | · | · | · | · | · |
| [khoj-ai/khoj](https://github.com/khoj-ai/khoj) | `ae229ca` | · | 3 | · | · | · | · |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | `7daa3ab` | · | · | · | · | · | langchain-anthropic |
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | `47a69e1` | 2 | · | · | · | · | @ai-sdk/anthropic, langchain-aws, litellm |
| [microsoft/autogen](https://github.com/microsoft/autogen) | `027ecf0` | · | 2 | · | · | · | · |
| [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm) | `ad97bc8` | 2 | · | · | · | · | · |
| [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | `d303ce8` | · | · | · | · | · | litellm |
| [openinterpreter/open-interpreter](https://github.com/openinterpreter/open-interpreter) | `89e7a86` | · | 4 | · | · | · | · |
| [Portkey-AI/gateway](https://github.com/Portkey-AI/gateway) | `669825c` | 4 | 5 | · | 2 | · | · |
| [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | `36874d9` | · | 2 | 3 | · | · | · |
| [run-llama/llama_index](https://github.com/run-llama/llama_index) | `2232f30` | · | 2 | · | · | · | litellm |
| [simonw/llm-anthropic](https://github.com/simonw/llm-anthropic) | `38c8ad2` | · | 1 | · | · | · | · |
| [sst/opencode](https://github.com/sst/opencode) | `0f54984` | · | 24 | · | 2 | · | @ai-sdk/amazon-bedrock, @ai-sdk/anthropic |
| [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy) | `4b60eb4` | · | 1 | · | · | · | litellm |
| [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | `3ea751c` | · | · | · | · | · | litellm |
| [TransformerOptimus/SuperAGI](https://github.com/TransformerOptimus/SuperAGI) | `c3c1982` | · | · | · | · | · | · |
| [yoheinakajima/babyagi](https://github.com/yoheinakajima/babyagi) | `fa8930e` | · | · | · | · | · | · |

Capability-gated call sites (`x if supports else y`) are reported as info and not counted. Test files are excluded.

Found a false positive? Please [open an issue](https://github.com/qiwei66/model-bump/issues). Precision matters more than recall here.
