import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * axe's violations inside `include` (the whole page without it), checked
 * against `tags` when given and every rule otherwise.
 */
export async function axeViolations(
  page: Page,
  include?: string,
  tags?: string[],
) {
  let builder = new AxeBuilder({ page });
  if (include) builder = builder.include(include);
  if (tags) builder = builder.withTags(tags);
  return (await builder.analyze()).violations;
}
