/**
 * §5.1 "No chat model is set up" routing gate (hotfix run 21).
 *
 * The empty-catalog route to Settings › Providers must fire ONLY on a SETTLED,
 * completed `profile/llm/list` read whose result is genuinely unusable:
 * the method was advertised, a fetch finished, it is not in flight, and the
 * list has no usable (available + selected) primary — including empty.
 *
 * It must NEVER fire when the read has not completed. Pre-session the hook's
 * refresh() early-returns (profile/llm/list needs a session_id — the mock
 * returns the config form without one), leaving `available: true` + an empty
 * list that is NOT evidence of an empty catalog. The picker stays the default
 * post-connect surface until a real list says otherwise.
 */

export interface NoModelSetupModel {
  readonly model: string;
  readonly provider: string;
  readonly title: string;
  readonly family?: string | undefined;
  readonly route?: string | undefined;
  readonly selected: boolean;
  readonly available: boolean;
}

export interface NoModelSetupInput {
  /** The server advertised profile/llm/list. */
  readonly available: boolean;
  /** A fetch is currently in flight. */
  readonly loading: boolean;
  /** The last settled list. */
  readonly models: readonly NoModelSetupModel[];
  /** True only after a profile/llm/list completed (settled evidence). */
  readonly fetched?: boolean | undefined;
}

/** Route ONLY on settled, fetched, unusable evidence — never on absence. */
export function shouldRouteNoModelSetup(input: NoModelSetupInput): boolean {
  if (!input.available) return false;
  if (input.loading) return false;
  if (input.fetched !== true) return false;
  return !input.models.some((model) => model.available && model.selected);
}
