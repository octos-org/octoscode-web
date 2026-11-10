// Test growth ratchet (shu, 11-07): a change may not add test lines on net.
// Test slimming deleted about 11,000 lines in three days while other changes
// added about 5,900 back; this step keeps the next change from undoing it.
//
//   node scripts/test-growth.mjs                       in CI: this commit against its base
//   node scripts/test-growth.mjs --base REV [--head REV]  locally (head defaults to HEAD)
//   node scripts/test-growth.mjs --count REV           one revision's total
//
// Lines are counted exactly as the team's wake/test-lines.py counts them, so
// the CI number and the daily number are the same number: every regular file
// of the revision's tree outside node_modules/; TS/JS/Python test files
// (*.test.*, *.spec.* for ts/tsx/js/jsx/mjs, test_*.py, *_test.py) count
// whole; Rust files count whole under tests/ or when named *_tests.rs,
// *_test.rs, test_*.rs or tests.rs, and otherwise only their #[cfg(test)]
// modules. A file's lines are its newline count plus one.
//
// A pull request (or its merge group) that adds lines fails unless its last
// LABEL event is a real `labeled` by a user, not a bot (shu, 11-10). The
// pull request's author may add it: every agent works as the one shared
// account anantheparty, and lead-web adds the label as that account after
// reviewing the growth. Only lead-web may add it; this script cannot tell
// lead-web from any other agent on that account, so that rule is procedure,
// written down in docs/testing.md. A push to main only reports.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LABEL = "test-growth-approved";

const SCRIPT_TEST =
  /(\.(test|spec)\.(ts|tsx|js|jsx|mjs)$)|(^test_.*\.py$)|(_test\.py$)/;

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

if (option("--count")) {
  const counted = await countTestLines(await resolveCommit(option("--count")));
  console.log(String(counted.total));
  process.exit(0);
}

const event = await ciEvent();
const head = await resolveCommit(option("--head") ?? "HEAD");
const baseRev = option("--base") ?? event.base;
if (!baseRev) {
  const counted = await countTestLines(head);
  console.log(
    `Test lines at ${short(head)}: ${format(counted.total)} (no base to compare with)`,
  );
  process.exit(0);
}
const base = await resolveCommit(baseRev);
const [before, after] = await Promise.all([
  countTestLines(base),
  countTestLines(head),
]);
const growth = after.total - before.total;
console.log("Test lines, counted as wake/test-lines.py counts them:");
console.log(`  base ${short(base)}: ${format(before.total)}`);
console.log(`  head ${short(head)}: ${format(after.total)}`);
console.log(`  change: ${signed(growth)}`);
const changed = [...new Set([...before.files.keys(), ...after.files.keys()])]
  .map((path) => ({
    path,
    delta: (after.files.get(path) ?? 0) - (before.files.get(path) ?? 0),
  }))
  .filter(({ delta }) => delta !== 0)
  .sort((a, b) => b.delta - a.delta || a.path.localeCompare(b.path));
if (changed.length > 0) {
  console.log("Files whose test lines changed:");
  for (const { path, delta } of changed)
    console.log(`  ${signed(delta).padStart(7)}  ${path}`);
}

if (growth <= 0) process.exit(0);
if (!event.enforce) {
  console.log(`Not enforced on ${event.name}: reported only.`);
  process.exit(0);
}
const approval = await growthApproval(event.pullRequest);
if (approval.approved) {
  console.log(
    `Growth of ${signed(growth)} approved: ${LABEL} added by ${approval.by}.`,
  );
  process.exit(0);
}
if (approval.note) console.log(approval.note);
const grown = changed.filter(({ delta }) => delta > 0).map(({ path }) => path);
console.log(
  `::error title=Test lines grew::This change adds ${growth} test lines on net (${format(before.total)} → ${format(after.total)}), in ${grown.join(", ")}. Delete as many test lines elsewhere in this pull request. If that cannot be done, list in its description what each added test guards and why it cannot be offset, ask lead-web to review it and add the ${LABEL} label, then re-run this job.`,
);
process.exit(1);

/**
 * The CI event: which base to compare with, and whether growth fails.
 * A pull_request checkout is the merge commit, whose first parent is the base
 * branch it was merged onto; a merge group carries its own base.
 */
async function ciEvent() {
  const name = process.env.GITHUB_EVENT_NAME ?? "local";
  const payload = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
    : {};
  if (name === "pull_request")
    return {
      name,
      enforce: true,
      base: "HEAD^1",
      pullRequest: { number: payload.pull_request.number },
    };
  if (name === "merge_group") {
    const number = /\/pr-(\d+)-/.exec(payload.merge_group.head_ref)?.[1];
    return {
      name,
      enforce: true,
      base: payload.merge_group.base_sha,
      pullRequest: number ? { number: Number(number) } : null,
    };
  }
  const before = payload.before;
  return {
    name,
    enforce: false,
    base: before && !/^0+$/.test(before) ? before : undefined,
    pullRequest: null,
  };
}

/** The label's last addition, and whether it counts as an approval. */
async function growthApproval(pullRequest) {
  if (!pullRequest)
    return {
      approved: false,
      note: "No pull request to read a label from.",
    };
  const repository = process.env.GITHUB_REPOSITORY;
  const events = (
    await gh(
      `repos/${repository}/issues/${pullRequest.number}/events`,
      `.[] | select((.event == "labeled" or .event == "unlabeled") and .label.name == "${LABEL}") | {event, login: .actor.login, type: .actor.type}`,
      true,
    )
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const last = events.at(-1);
  if (!last || last.event !== "labeled")
    return { approved: false, note: `No ${LABEL} label.` };
  if (last.type === "Bot")
    return {
      approved: false,
      note: `${LABEL} was added by ${last.login}, which does not count: a bot may not approve.`,
    };
  return { approved: true, by: last.login };
}

async function gh(endpoint, jq, paginate = false) {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", ...(paginate ? ["--paginate"] : []), endpoint, "--jq", jq],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.trim();
}

/** A commit id for `rev`, fetching it when the shallow checkout lacks it. */
async function resolveCommit(rev) {
  try {
    return await git(["rev-parse", "--verify", `${rev}^{commit}`]);
  } catch {
    if (rev === "HEAD^1") {
      await git(["fetch", "--no-tags", "--quiet", "--deepen=1", "origin"]);
    } else {
      await git(["fetch", "--no-tags", "--quiet", "--depth=1", "origin", rev]);
    }
    return git(["rev-parse", "--verify", `${rev}^{commit}`]);
  }
}

async function git(argv, input) {
  const child = execFile("git", argv, {
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (input !== undefined) child.stdin.end(input);
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  const errors = [];
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0)
    throw new Error(
      `git ${argv.join(" ")} failed: ${Buffer.concat(errors).toString()}`,
    );
  const out = Buffer.concat(chunks);
  return input === undefined ? out.toString().trim() : out;
}

/** Test lines per file and in total, for one commit. */
async function countTestLines(commit) {
  const listing = (await git(["ls-tree", "-r", "-z", commit], "")).toString();
  const candidates = [];
  for (const entry of listing.split("\0")) {
    if (!entry) continue;
    const [meta, path] = entry.split("\t");
    const [mode, type, object] = meta.split(" ");
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) continue;
    if (path.includes("node_modules/")) continue;
    if (!path.endsWith(".rs") && !SCRIPT_TEST.test(basename(path))) continue;
    candidates.push({ path, object });
  }
  const contents = await readBlobs(candidates.map(({ object }) => object));
  const files = new Map();
  let total = 0;
  candidates.forEach(({ path }, index) => {
    const text = new TextDecoder().decode(contents[index]);
    const lines = text.split("\n");
    const count = path.endsWith(".rs")
      ? rustTestFile(path)
        ? lines.length
        : inlineTestLines(lines)
      : lines.length;
    if (!count) return;
    files.set(path, count);
    total += count;
  });
  return { total, files };
}

/** Blob contents in order, through one `git cat-file --batch`. */
async function readBlobs(objects) {
  if (objects.length === 0) return [];
  const out = await git(["cat-file", "--batch"], `${objects.join("\n")}\n`);
  const blobs = [];
  let offset = 0;
  for (let index = 0; index < objects.length; index += 1) {
    const end = out.indexOf(0x0a, offset);
    const size = Number(out.subarray(offset, end).toString().split(" ")[2]);
    blobs.push(out.subarray(end + 1, end + 1 + size));
    offset = end + 1 + size + 1;
  }
  return blobs;
}

function rustTestFile(path) {
  const name = basename(path);
  return (
    path.split("/").includes("tests") ||
    name.endsWith("_tests.rs") ||
    name.endsWith("_test.rs") ||
    name.startsWith("test_") ||
    name === "tests.rs"
  );
}

/** Lines of #[cfg(test)] modules, brace matched (test-lines.py's rule). */
function inlineTestLines(lines) {
  let count = 0;
  let index = 0;
  while (index < lines.length) {
    if (/^\s*#\[cfg\(test\)\]/.test(lines[index])) {
      let next = index + 1;
      while (
        next < lines.length &&
        (lines[next].trim().startsWith("#[") || !lines[next].trim())
      )
        next += 1;
      if (
        next < lines.length &&
        /^\s*(pub(\(\w+\))?\s+)?mod\s+\w+\s*\{/.test(lines[next])
      ) {
        let depth = 0;
        let end = next;
        while (end < lines.length) {
          depth += lines[end].split("{").length - lines[end].split("}").length;
          if (depth <= 0 && end > next) break;
          end += 1;
        }
        count += end - index + 1;
        index = end + 1;
        continue;
      }
    }
    index += 1;
  }
  return count;
}

function short(commit) {
  return commit.slice(0, 9);
}

function format(value) {
  return value.toLocaleString("en-US");
}

function signed(value) {
  return value > 0 ? `+${format(value)}` : format(value);
}
