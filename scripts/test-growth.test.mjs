import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_LIMIT, approval, growthError } from "./test-growth-approval.mjs";

const labeled = (login, type = "User") => ({ event: "labeled", login, type });
const agent = [labeled("anantheparty")];
const person = [labeled("shu")];

test("the agents' account approves up to the limit and a person beyond it", () => {
  assert.equal(AGENT_LIMIT, 150);
  assert.deepEqual(approval(150, agent), {
    approved: true,
    by: "anantheparty",
  });
  assert.equal(approval(151, agent).approved, false);
  assert.match(approval(151, agent).note, /shared account.*at most 150/);
  assert.deepEqual(approval(151, person), { approved: true, by: "shu" });
});

test("only the last label event counts, and never a bot's", () => {
  assert.equal(approval(1, []).approved, false);
  assert.equal(
    approval(1, [...person, { ...person[0], event: "unlabeled" }]).approved,
    false,
  );
  assert.equal(
    approval(1, [labeled("github-actions[bot]", "Bot")]).approved,
    false,
  );
  assert.equal(approval(151, [...person, ...agent]).approved, false);
});

test("over the limit the failure says how much, the limit, and to cut", () => {
  const error = growthError(151, ["e2e/a.spec.ts"]);
  assert.match(error, /adds 151 test lines on net, in e2e\/a\.spec\.ts/);
  assert.match(
    error,
    /limit of 150.*only a person may add test-growth-approved/,
  );
  assert.match(error, /Cut the growth to 150 or less/);
  assert.doesNotMatch(growthError(150, ["e2e/a.spec.ts"]), /limit|Cut/);
});
