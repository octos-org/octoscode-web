/**
 * Pure match-collection for the conversation search: given one text
 * node's content and the needle, returns [start, end) offset pairs.
 * Extracted from use-conversation-search so the overlap/adjacency and
 * case handling are unit-testable without a DOM.
 */

export function collectMatchOffsets(
  text: string,
  needle: string,
  caseSensitive: boolean,
): Array<[number, number]> {
  if (needle.length === 0) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const probe = caseSensitive ? needle : needle.toLowerCase();
  const matches: Array<[number, number]> = [];
  let from = 0;
  let hit = haystack.indexOf(probe, from);
  while (hit !== -1) {
    matches.push([hit, hit + needle.length]);
    from = hit + needle.length;
    hit = haystack.indexOf(probe, from);
  }
  return matches;
}
