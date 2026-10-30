/**
 * Short "good at" tags for configured models.
 *
 * Source: a local table, not server data. `profile/llm/list` and
 * `profile/llm/catalog` carry no capability fields (checked against Core
 * v2.0.3 and main, 2026-10). The rules follow each vendor's public naming:
 * flash/mini/haiku tiers are the low-latency ones, pro/opus/reasoning tiers
 * target harder problems, coder/codex/sonnet lines are positioned for code,
 * Kimi/Gemini/MiniMax advertise long context, and the domestic families are
 * tuned for Chinese. Local routes run on the user's own machine. Replace this
 * with server metadata once Core exposes it.
 */
export type ModelStrength = "local" | "code" | "deep" | "fast" | "long" | "zh";

const LOCAL_PROVIDERS = new Set([
  "local",
  "ollama",
  "vllm",
  "llamacpp",
  "lmstudio",
]);

const RULES: readonly (readonly [ModelStrength, RegExp])[] = [
  ["code", /coder|codex|\bcode\b|sonnet/],
  [
    "deep",
    /(^|[-_/ ])pro\b|opus|reason|thinking|\br1\b|\bo[134]\b(?!-mini)|\bk3\b|gpt-5(?![.\d]*-(?:mini|nano))/,
  ],
  ["fast", /flash|mini|nano|haiku|lite|turbo|\bair\b|instant/],
  ["long", /kimi|moonshot|gemini|minimax/],
  [
    "zh",
    /glm|qwen|deepseek|kimi|moonshot|minimax|hunyuan|doubao|ernie|zhipu|dashscope/,
  ],
];

const LABELS: Record<ModelStrength, string> = {
  local: "Runs locally",
  code: "Coding",
  deep: "Hard problems",
  fast: "Fast",
  long: "Long documents",
  zh: "Chinese",
};

/** At most three tags, most distinctive first. */
export function modelStrengths(
  model: string,
  provider: string,
): ModelStrength[] {
  const id = `${provider} ${model}`.toLowerCase();
  const tags: ModelStrength[] = LOCAL_PROVIDERS.has(provider.toLowerCase())
    ? ["local"]
    : [];
  for (const [tag, pattern] of RULES) {
    if (pattern.test(id) && !tags.includes(tag)) tags.push(tag);
  }
  // A tier cannot be both the fast one and the heavy one.
  const deep = tags.indexOf("deep");
  if (deep >= 0 && tags.includes("fast")) tags.splice(deep, 1);
  return tags.slice(0, 3);
}

export function modelStrengthLabel(tag: ModelStrength): string {
  return LABELS[tag];
}
