// Static source rules: patterns that break (or silently change) when the
// model ID is bumped to claude-opus-5-5. Each rule is a regex over a whole
// file; `when` / `unless` are file-level gates that cut false positives.

import { DOC } from './opus-5-5.js';

// A file has to look like it talks to Claude before most rules apply.
const ANTHROPIC = /anthropic|claude|ChatAnthropic|ChatBedrock|bedrock/i;

// Variable names that almost always hold a model response (vs. an input message).
const RESPONSE_NAMES = '(?:resp|response|res|result|completion|message|reply|answer|output|r|json|data|body|ai_msg|ai_message|llm_response|api_response|claude_response|final_message|final)';

export const SOURCE_RULES = [
  // ---- thinking ------------------------------------------------------------
  {
    id: 'thinking-disabled',
    severity: 'error',
    when: ANTHROPIC,
    patterns: [
      /thinking["']?\s*[:=]\s*(?:\{|dict\()\s*["']?type["']?\s*[:=]\s*["']disabled["']/g,
      /\bThinkingConfigDisabled\b|\bOfDisabled\b/g,
    ],
    codeOnly: true,
    gateable: true,
    title: 'Disables thinking — Opus 5.5 rejects thinking: {type: "disabled"} (400)',
    fix: 'Remove `thinking`; use output_config.effort "low" where you disabled it to save tokens.',
    doc: DOC.thinking,
  },
  {
    id: 'thinking-budget',
    severity: 'error',
    when: ANTHROPIC,
    patterns: [/\bbudget_tokens\b|\bbudgetTokens\b|\bThinkingConfigEnabled\b/g],
    codeOnly: true,
    gateable: true,
    title: 'Manual thinking budget — Opus 5.5 rejects thinking: {type: "enabled", budget_tokens} (400)',
    fix: 'Remove `thinking` (adaptive is always on) and set output_config.effort instead of a token budget.',
    doc: DOC.thinking,
  },

  // ---- forced tool use -------------------------------------------------------
  {
    id: 'forced-tool-choice',
    severity: 'error',
    when: ANTHROPIC,
    patterns: [
      // Anthropic SDKs: tool_choice={"type": "any"} / {type: "tool", name}
      /tool_choice["']?\s*[:=]\s*(?:\{|dict\()\s*["']?type["']?\s*[:=]\s*["'](?:any|tool)["']/g,
      // LangChain bind_tools(tool_choice="any"|True), LiteLLM tool_choice="required"
      /\btool_choice\s*=\s*(?:["'](?:any|required)["']|True\b)/g,
      /\btool_choice["']?\s*:\s*["'](?:any|required)["']/g,
      // Vercel AI SDK
      /\btoolChoice\s*:\s*(?:["']required["']|\{\s*type\s*:\s*["']tool["'])/g,
      // Java / Kotlin / C# SDKs (builder or constructor, not type declarations)
      /\bToolChoice(?:Any|Tool)\s*(?:\.builder\(|\()/g,
    ],
    codeOnly: true,
    gateable: true,
    title: 'Forces a tool call — Opus 5.5 rejects tool_choice "any" / "tool" (400)',
    fix: 'Use tool_choice "auto" + strict tool use, or structured outputs (output_config.format). Say in the prompt when the tool applies.',
    doc: DOC.toolChoice,
  },
  {
    id: 'framework-structured-output',
    severity: 'warn',
    when: /ChatAnthropic|ChatBedrock|langchain_anthropic|langchain_aws|@langchain\/anthropic/,
    patterns: [/\.with_structured_output\(|\.withStructuredOutput\(/g, /response_format\s*=\s*ToolStrategy\b/g],
    title: 'LangChain structured output via tool calling is no longer forced on Opus 5.5 — raises OutputParserException when the model answers in text',
    fix: 'Pass method="json_schema" (native structured outputs). ToolStrategy in create_agent() still forces tool_choice → 400 (langchain#40777).',
    doc: 'https://github.com/langchain-ai/langchain/issues/40777',
  },
  {
    id: 'framework-structured-output',
    severity: 'warn',
    when: /@ai-sdk\/amazon-bedrock/,
    patterns: [/\bgenerateObject\(|\bstreamObject\(|\bOutput\.object\(/g],
    title: 'Vercel AI SDK + Bedrock: structured output / forced tools can 400 on Opus 5.5',
    fix: '@ai-sdk/amazon-bedrock 5.0.91 maps toolChoice "required" to a forced call (vercel/ai#21364). Use bedrockAnthropic() or upgrade once fixed.',
    doc: 'https://github.com/vercel/ai/issues/21364',
  },

  // ---- sampling ----------------------------------------------------------------
  {
    id: 'sampling-params',
    severity: 'warn',
    when: ANTHROPIC,
    patterns: [
      /\btemperature\s*[:=]\s*(?!1(?:\.0+)?\b)(?:\d+\.?\d*|\.\d+)/g,
      /\b(?:top_p|top_k|topP|topK)\s*[:=]\s*\d/g,
    ],
    codeOnly: true,
    title: 'Sets temperature / top_p / top_k — Opus 5.5 rejects non-default sampling parameters (400)',
    fix: 'Remove them (including on wrappers like ChatAnthropic(temperature=0)). Steer with the prompt instead.',
    doc: DOC.sampling,
  },

  // ---- prefill -----------------------------------------------------------------
  {
    id: 'assistant-prefill',
    severity: 'warn',
    when: ANTHROPIC,
    patterns: [
      // {"role": "assistant", "content": "..."} ]   (last element of a list literal)
      /["']?role["']?\s*:\s*["']assistant["']\s*,\s*["']?content["']?\s*:\s*[fr]?(["'`])(?:(?!\1)[^\\\n]|\\.){0,300}\1\s*,?\s*\}\s*,?\s*\]/g,
      // LangChain: AIMessage("...")]  /  ("assistant", "...")]
      /AIMessage\(\s*(?:content\s*=\s*)?[fr]?(["'])(?:(?!\1)[^\\\n]|\\.){0,300}\1\s*\)\s*,?\s*\]/g,
      /\(\s*["'](?:assistant|ai)["']\s*,\s*[fr]?(["'])(?:(?!\1)[^\\\n]|\\.){0,300}\1\s*\)\s*,?\s*\]/g,
    ],
    title: 'Looks like an assistant prefill (message list ends with an assistant turn) — rejected (400)',
    fix: 'Use structured outputs (output_config.format) or system-prompt instructions instead of prefilling.',
    doc: DOC.prefill,
  },

  // ---- response shape ----------------------------------------------------------
  {
    id: 'content-by-position',
    severity: 'error',
    when: ANTHROPIC,
    patterns: [
      new RegExp(`\\b${RESPONSE_NAMES}\\.content\\[0\\]\\??\\.text\\b`, 'g'),
      new RegExp(`\\b${RESPONSE_NAMES}\\.content\\[0\\]\\[["']text["']\\]`, 'g'),
      /\.content\(\)\.get\(0\)\.(?:text|asText)\(\)/g,
    ],
    title: 'Reads content[0] as text — Opus 5.5 responses can start with a thinking block, and then this is empty/undefined or throws',
    fix: 'Select blocks by type: next(b.text for b in resp.content if b.type == "text")  /  resp.content.find(b => b.type === "text")',
    doc: DOC.responseShape,
  },
  {
    id: 'content-by-position',
    severity: 'warn',
    when: ANTHROPIC,
    patterns: [/(?<!\])\.content\[0\]\??\.text\b/g, /(?<!\])\.content\[0\]\[["']text["']\]/g],
    title: 'Reads content[0].text — if this is a Claude response, block 0 can now be a thinking block',
    fix: 'If this reads a model response, select the block with type == "text" instead of indexing content[0].',
    doc: DOC.responseShape,
  },
  {
    id: 'content-by-position',
    severity: 'warn',
    when: ANTHROPIC,
    patterns: [/(?<!\])\.content\[0\]\??\.(?:input|name|id)\b/g],
    title: 'Reads a tool_use block by position — on Opus 5.5 a thinking block can come first',
    fix: 'Find the block with type == "tool_use" instead of indexing content[0].',
    doc: DOC.responseShape,
  },
  {
    id: 'stream-first-block',
    severity: 'warn',
    when: /content_block_start/,
    patterns: [/\bindex\s*===?\s*0\b/g],
    title: 'Stream handler special-cases block index 0 — on Opus 5.5 block 0 can be a thinking block',
    fix: 'Branch on content_block.type (thinking / text / tool_use) instead of the index.',
    doc: DOC.responseShape,
  },

  // ---- tools / betas / params --------------------------------------------------
  {
    id: 'computer-use-legacy',
    severity: 'error',
    patterns: [/computer_20251124|computer-use-2025-11-24/g],
    title: 'Legacy computer use tool — rejected on the Claude API and Google Cloud (Bedrock still accepts it)',
    fix: 'Declare computer_toolset_20260801 (no name/display size/beta header) and handle several member tool_use blocks per turn.',
    doc: DOC.computer,
  },
  {
    id: 'obsolete-beta',
    severity: 'info',
    patterns: [
      /effort-2025-11-24|interleaved-thinking-2025-05-14|fine-grained-tool-streaming-2025-05-14|token-efficient-tools-2025-02-19|output-128k-2025-02-19|context-1m-\d{4}-\d{2}-\d{2}/g,
    ],
    title: 'Beta header with no effect on Opus 5.5',
    fix: 'Remove it — the feature is built in (1M context is the default).',
    doc: DOC.betas,
  },
  {
    id: 'output-format-deprecated',
    severity: 'info',
    when: ANTHROPIC,
    patterns: [/\boutput_format\s*=\s*\{|["']output_format["']\s*:/g],
    title: '`output_format` is deprecated',
    fix: 'Move to output_config={"format": {...}} (the parse()/stream() helper argument output_format=Model is unchanged).',
    doc: DOC.outputFormat,
  },
  {
    id: 'refusal-unhandled',
    severity: 'info',
    when: ANTHROPIC,
    unless: /refusal/,
    once: true,
    patterns: [/\bstop_reason\b|\bstopReason\b/g],
    title: 'Handles stop_reason but never "refusal" — Opus 5.5 classifiers refuse in more categories (bio, reasoning_extraction, cyber)',
    fix: 'Handle stop_reason "refusal" and read stop_details.category; configure fallback.',
    doc: `${DOC.responseShape.split('#')[0]}#safety-classifiers-and-fallback`,
  },
];

// Older Claude model IDs — reported as "places to bump", not as problems.
export const MODEL_REF = /\bclaude-(?:opus|sonnet|haiku|fable|mythos)-\d[\w.-]*|\bclaude-\d(?:[-.]\d)?-(?:opus|sonnet|haiku)[\w.-]*|\banthropic\.claude-[\w.:-]+/g;
export const TARGET_REF = /\bclaude-opus-5-5\b/;
