import type { LlmCatalogResult } from "@octos-org/octoscode-client";

export type CatalogFamily = LlmCatalogResult["families"][number];

const PROVIDERS = [
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
    aliases: ["zhipu"],
    name: "智谱 AI",
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
] as const;

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
    : { name: familyId, tag: "OpenAI-compatible provider" };
}

function providerRank(familyId: string) {
  const index = PROVIDERS.findIndex((candidate) =>
    candidate.aliases.some((alias) => alias === familyId),
  );
  return index < 0 ? PROVIDERS.length : index;
}
