import type { SessionHydrateResult } from "@octos-org/octoscode-client/protocol";
import type {
  HydratedTimelineIdentityOptions,
  TimelineEntry,
} from "./model.ts";

export type CanonicalHydrate = (
  result: SessionHydrateResult,
  identities?: HydratedTimelineIdentityOptions,
) => TimelineEntry[];

let loaded: CanonicalHydrate | null = null;

/** The canonical restorer, once a hydrate proved the server retains replay. */
export function canonicalHydrate(): CanonicalHydrate | null {
  return loaded;
}

/**
 * Core #2296 canonical replay recovery ships in a cold chunk: a server that
 * retains no `replayed_projection_envelopes` never pays for it. Hydrate awaits
 * this so the synchronous transcript reducer can use the restorer. A chunk
 * that cannot be fetched degrades to the durable projection — recovery loses
 * replay detail, it never fails the Session.
 */
export async function prepareCanonicalHydrate(
  result: SessionHydrateResult,
): Promise<void> {
  if (loaded || result.replayed_projection_envelopes === undefined) return;
  try {
    loaded = (await import("./canonical-hydrate.ts"))
      .timelineFromCanonicalHydrate;
  } catch {
    loaded = null;
  }
}
