import Anthropic from "@anthropic-ai/sdk";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { generateText, generateObject } from "ai";

const client = new Anthropic();

export async function run(q: string) {
  const msg = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    tool_choice: { type: "any" },
    tools: [{ type: "computer_20251124", name: "computer", display_width_px: 1280, display_height_px: 800 }],
    messages: [{ role: "user", content: q }],
  }, { headers: { "anthropic-beta": "computer-use-2025-11-24,interleaved-thinking-2025-05-14" } });
  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  return text;
}

export async function viaVercel(q: string) {
  return generateText({ model: bedrock("anthropic.claude-opus-5-v1:0"), toolChoice: "required", prompt: q });
}
