// Who may approve test growth (scripts/test-growth.mjs): the rules alone, with
// no git or GitHub access, so scripts/test-growth.test.mjs can pin them.

export const LABEL = "test-growth-approved";

// shu, 11-25 & 11-27:
// - A human PR author's own label never counts.
// - The agents' shared account (anantheparty) may approve another author's PR
//   without the 150-line cap, and approves its own PRs up to AGENT_LIMIT
//   (lead-web review under the web self-merge workflow).
// - Any other person (non-author, non-bot) may approve any PR.
export const AGENT_LIMIT = 150;
export const AGENT_ACCOUNTS = new Set(["anantheparty"]);

const isAgent = (login) => AGENT_ACCOUNTS.has(login.toLowerCase());

/**
 * Whether the last LABEL event approves `growth` net test lines on a PR opened
 * by `author`. `events` are the pull request's labeled/unlabeled events for
 * LABEL, oldest first, each `{ event, login, type }`.
 */
export function approval(growth, events, author) {
  const last = events.at(-1);
  if (!last || last.event !== "labeled")
    return { approved: false, note: `No ${LABEL} label.` };
  if (last.type === "Bot")
    return {
      approved: false,
      note: `${LABEL} was added by ${last.login}, which does not count: a bot may not approve.`,
    };
  const prAuthor = typeof author === "string" ? author.trim() : "";
  if (!prAuthor)
    return {
      approved: false,
      note: `Pull request author is unknown; ${LABEL} does not approve this growth.`,
    };
  const labelerIsAgent = isAgent(last.login);
  const authorIsAgent = isAgent(prAuthor);
  if (!authorIsAgent && last.login.toLowerCase() === prAuthor.toLowerCase())
    return {
      approved: false,
      note: `${LABEL} was added by ${last.login}, the pull request author, which does not count.`,
    };
  if (labelerIsAgent && authorIsAgent && growth > AGENT_LIMIT)
    return {
      approved: false,
      note: `${LABEL} was added by ${last.login}, the agents' shared account, which approves at most ${AGENT_LIMIT} test lines on its own pull requests.`,
    };
  return { approved: true, by: last.login };
}

/** The failure for unapproved growth: how much, and what the author does. */
export function growthError(growth, grown) {
  const added = `This change adds ${growth} test lines on net, in ${grown.join(", ")}.`;
  if (growth > AGENT_LIMIT)
    return `${added} That is over the ${AGENT_LIMIT}-line limit for the agents' shared account on its own pull requests; a pull request author's own ${LABEL} label does not count, so a reviewer other than the author (another person, or the shared agent account on someone else's pull request) must add ${LABEL}. Cut the growth to ${AGENT_LIMIT} or less in this pull request: delete tests that repeat a guard another test already holds, fold their setup and assertions into the tests that stay, and drop tests the keep list no longer holds. Do not weaken assertions or drop key guards. Then push and re-run this job.`;
  return `${added} Delete as many test lines elsewhere in this pull request. If that cannot be done, list in its description what each added test guards and why it cannot be offset, ask a reviewer other than the author (for agent pull requests, lead-web) to review it and add the ${LABEL} label, then re-run this job.`;
}
