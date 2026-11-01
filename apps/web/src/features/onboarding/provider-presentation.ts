import type { LlmCatalogResult } from "@octos-org/octoscode-client";

export type CatalogFamily = LlmCatalogResult["families"][number];

const PROVIDERS = [
  {
    aliases: ["zai-coding"],
    name: "Z.ai Coding Plan",
    tag: "GLM coding and agents",
  },
  {
    aliases: ["deepseek"],
    name: "DeepSeek 深度求索",
    tag: "Reasoning and coding",
  },
  {
    aliases: ["moonshot", "kimi"],
    name: "Kimi 月之暗面",
    tag: "Long context and reasoning",
  },
  {
    aliases: ["zai"],
    name: "Z.ai",
    tag: "GLM coding and agents",
  },
  {
    aliases: ["dashscope", "qwen"],
    name: "通义千问",
    tag: "Multimodal and coding",
  },
  {
    aliases: ["minimax"],
    name: "MiniMax",
    tag: "Fast and cost-efficient",
  },
  {
    aliases: ["zhipu"],
    name: "智谱 AI",
    tag: "GLM coding and agents",
  },
  {
    aliases: ["anthropic"],
    name: "Anthropic",
    tag: "Claude models from Anthropic",
  },
  {
    aliases: ["gemini"],
    name: "Google Gemini",
    tag: "Gemini models from Google",
  },
  {
    aliases: ["groq"],
    name: "Groq",
    tag: "Low-latency inference from Groq",
  },
  {
    aliases: ["local"],
    name: "Local model server",
    tag: "A model server on your own machine",
  },
  {
    aliases: ["minimax-cn"],
    name: "MiniMax 中国站",
    tag: "MiniMax models for the China region",
  },
  {
    aliases: ["moonshot-coding", "kimi-coding"],
    name: "Kimi Coding Plan",
    tag: "Kimi models for coding",
  },
  {
    aliases: ["nvidia"],
    name: "NVIDIA NIM",
    tag: "Inference with NVIDIA NIM",
  },
  {
    aliases: ["ollama"],
    name: "Ollama",
    tag: "Local models through Ollama",
  },
  {
    aliases: ["openai"],
    name: "OpenAI",
    tag: "GPT models from OpenAI",
  },
  {
    aliases: ["openrouter"],
    name: "OpenRouter",
    tag: "Multiple model providers through OpenRouter",
  },
  {
    aliases: ["r9s"],
    name: "R9S",
    tag: "Custom model service configured as r9s",
  },
  {
    aliases: ["vertex"],
    name: "Google Vertex AI",
    tag: "Models through Google Cloud Vertex AI",
  },
  {
    aliases: ["vllm"],
    name: "vLLM",
    tag: "An OpenAI-compatible vLLM server",
  },
] as const;

/** The first six are the curated first-run choices; everything remains
 * available under More providers in this stable order. */
export function orderedProviderFamilies(
  catalog: LlmCatalogResult,
): CatalogFamily[] {
  const sorted = [...catalog.families].sort((left, right) => {
    const difference = providerRank(left.id) - providerRank(right.id);
    return difference || left.id.localeCompare(right.id);
  });
  return sorted;
}

export function providerPresentation(familyId: string) {
  const provider = PROVIDERS.find((candidate) =>
    candidate.aliases.some((alias) => alias === familyId),
  );
  return provider
    ? { name: provider.name, tag: provider.tag }
    : {
        name: familyId.replaceAll(/[-_]/g, " "),
        tag: "Model service supplied by the server catalog",
      };
}

function providerRank(familyId: string) {
  const index = PROVIDERS.findIndex((candidate) =>
    candidate.aliases.some((alias) => alias === familyId),
  );
  return index < 0 ? PROVIDERS.length : index;
}
