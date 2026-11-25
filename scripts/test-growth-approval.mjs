// Who may approve test growth (scripts/test-growth.mjs): the rules alone, with
// no git or GitHub access, so scripts/test-growth.test.mjs can pin them.

export const LABEL = "test-growth-approved";

// shu, 11-25: above this many test lines on net, only a label added by a
// person counts. Every agent works as the shared account below, so its label
// approves small growth only; a larger change goes back to its author to cut.
export const AGENT_LIMIT = 150;
export const AGENT_ACCOUNTS = new Set(["anantheparty"]);

/**
 * Whether the last LABEL event approves `growth` net test lines. `events` are
 * the pull request's labeled/unlabeled events for LABEL, oldest first, each
 * `{ event, login, type }`.
 */
export function approval(growth, events) {
  const last = events.at(-1);
  if (!last || last.event !== "labeled")
    return { approved: false, note: `No ${LABEL} label.` };
  if (last.type === "Bot")
    return {
      approved: false,
      note: `${LABEL} was added by ${last.login}, which does not count: a bot may not approve.`,
    };
  if (growth > AGENT_LIMIT && AGENT_ACCOUNTS.has(last.login))
    return {
      approved: false,
      note: `${LABEL} was added by ${last.login}, the agents' shared account, which approves at most ${AGENT_LIMIT} test lines.`,
    };
  return { approved: true, by: last.login };
}

/** The failure for unapproved growth: how much, and what the author does. */
export function growthError(growth, grown) {
  const added = `This change adds ${growth} test lines on net, in ${grown.join(", ")}.`;
  if (growth > AGENT_LIMIT)
    return `${added} That is over the limit of ${AGENT_LIMIT}, above which only a person may add ${LABEL}; an agent's label does not count. Cut the growth to ${AGENT_LIMIT} or less in this pull request: delete tests that repeat a guard another test already holds, fold their setup and assertions into the tests that stay, and drop tests the keep list no longer holds. Do not weaken assertions or drop key guards. Then push and re-run this job.`;
  return `${added} Delete as many test lines elsewhere in this pull request. If that cannot be done, list in its description what each added test guards and why it cannot be offset, ask lead-web to review it and add the ${LABEL} label, then re-run this job.`;
}
