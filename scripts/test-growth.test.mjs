import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_LIMIT, approval, growthError } from "./test-growth-approval.mjs";

const labeled = (login, type = "User") => ({ event: "labeled", login, type });
const agent = [labeled("anantheparty")];
const person = [labeled("shu")];

test("approval enforces author, shared agent account, and non-author rules", () => {
  assert.equal(AGENT_LIMIT, 150);
  const cases = [
    // 1. Human author labeling their own PR never counts (even <= 150 or different case).
    [10, [labeled("ymote")], "ymote", false, /pull request author/],
    [200, [labeled("YMOTE")], "ymote", false, /pull request author/],
    // 2. Shared agent account labeling someone else's PR counts with no 150-line cap.
    [10, agent, "ymote", true, null],
    [300, agent, "ymote", true, null],
    // 3. Shared agent account on its own PR counts up to 150 and rejects above 150.
    [150, agent, "anantheparty", true, null],
    [151, agent, "anantheparty", false, /shared account.*at most 150/],
    // 4. Another person (non-author, non-bot) approves any PR regardless of growth.
    [151, person, "ymote", true, null],
    [151, person, "anantheparty", true, null],
    // Missing or unreadable author fails closed.
    [10, person, undefined, false, /author is unknown/],
    [10, agent, "", false, /author is unknown/],
  ];
  for (const [growth, events, author, expected, notePattern] of cases) {
    const verdict = approval(growth, events, author);
    assert.equal(verdict.approved, expected);
    if (expected) assert.equal(verdict.by, events.at(-1).login);
    else assert.match(verdict.note, notePattern);
  }
});

test("only the last label event counts, and never a bot's", () => {
  assert.equal(approval(1, [], "ymote").approved, false);
  assert.equal(
    approval(1, [...person, { ...person[0], event: "unlabeled" }], "ymote")
      .approved,
    false,
  );
  assert.equal(
    approval(1, [labeled("github-actions[bot]", "Bot")], "ymote").approved,
    false,
  );
  assert.equal(
    approval(151, [...person, ...agent], "anantheparty").approved,
    false,
  );
});

test("growthError explains author restriction, shared-account limit, and cutting", () => {
  const over = growthError(151, ["e2e/a.spec.ts"]);
  assert.match(over, /adds 151 test lines on net, in e2e\/a\.spec\.ts/);
  assert.match(
    over,
    /150-line limit.*author's own test-growth-approved label does not count/,
  );
  assert.match(over, /Cut the growth to 150 or less/);
  const within = growthError(150, ["e2e/a.spec.ts"]);
  assert.match(within, /reviewer other than the author/);
  assert.doesNotMatch(within, /Cut the growth/);
});
