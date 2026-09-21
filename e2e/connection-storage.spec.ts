import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TAB_KEY = "octoscode-web.tab-connection.v3";
const DRAFT_PREFIX = "octoscode-web.draft.v1:";

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/storage-check");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

async function warnsOnLeave(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function reopen(page: Page, url: string, token = "tab-scoped-e2e-token") {
  await page.goto(url);
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

async function connectionAction(
  page: Page,
  action: "Disconnect" | "Forget server",
) {
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: action, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
}

test("closed-tab drafts restore only for the authenticated principal and Forget clears that principal", async ({
  page,
  context,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("First session, owner A");
  const firstUrl = page.url();
  const second = await context.newPage();
  await start(second);
  await second
    .getByRole("textbox", { name: "Message Octos" })
    .fill("Second session, owner A");
  const secondUrl = second.url();
  await input.fill("Updated first session, owner A");
  await expect.poll(() => warnsOnLeave(page)).toBe(false);
  await expect.poll(() => warnsOnLeave(second)).toBe(false);
  await page.close();
  await second.close();

  const restored = await context.newPage();
  await reopen(restored, firstUrl, "remember-this-tab-token");
  await expect(
    restored.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Updated first session, owner A");
  const otherOwner = await context.newPage();
  await reopen(otherOwner, secondUrl, "forget-me-token");
  await expect(
    otherOwner.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("");
  await otherOwner
    .getByRole("textbox", { name: "Message Octos" })
    .fill("Same session, owner B");
  await expect.poll(() => warnsOnLeave(otherOwner)).toBe(false);

  const otherSession = await context.newPage();
  await reopen(otherSession, secondUrl);
  await expect(
    otherSession.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Second session, owner A");
  await connectionAction(restored, "Disconnect");
  await restored.reload();
  await restored
    .getByRole("button", { name: "Forget saved connection", exact: true })
    .click();
  await otherSession.close();
  await otherOwner.close();
  const forgotten = await context.newPage();
  await reopen(forgotten, firstUrl);
  await expect(
    forgotten.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("");
  const retained = await context.newPage();
  await reopen(retained, secondUrl, "forget-me-token");
  await expect(
    retained.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Same session, owner B");
  const durable = await retained.evaluate(() => JSON.stringify(localStorage));
  for (const token of [
    "tab-scoped-e2e-token",
    "remember-this-tab-token",
    "forget-me-token",
  ]) {
    expect(durable).not.toContain(token);
  }
  expect(durable).not.toContain(TAB_KEY);
  expect(durable).not.toContain("owner A");
});

test("a delayed principal lookup preserves newly typed text and cannot restore a retired identity", async ({
  page,
  context,
}) => {
  await start(page);
  await page
    .getByRole("textbox", { name: "Message Octos" })
    .fill("Older saved draft");
  await expect.poll(() => warnsOnLeave(page)).toBe(false);
  const savedUrl = page.url();
  await page.close();
  const delayed = await context.newPage();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await delayed.route("**/api/auth/me", async (route) => {
    await held;
    await route.fulfill({ json: { user: { id: "fixture-user" } } });
  });
  await reopen(delayed, savedUrl);
  const input = delayed.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Typed while authentication identity was loading");
  release();
  await expect.poll(() => warnsOnLeave(delayed)).toBe(false);
  await expect(input).toHaveValue(
    "Typed while authentication identity was loading",
  );

  await connectionAction(delayed, "Disconnect");
  await delayed.unroute("**/api/auth/me");
  let releaseRetired!: () => void;
  const retired = new Promise<void>((resolve) => {
    releaseRetired = resolve;
  });
  let retiredStarted = false;
  let retiredDelivered = false;
  await delayed.route("**/api/auth/me", async (route) => {
    if (route.request().headers().authorization === "Bearer forget-me-token") {
      await route.fulfill({ json: { user: { id: "other-user" } } });
    } else {
      retiredStarted = true;
      await retired;
      await route.fulfill({ json: { user: { id: "fixture-user" } } });
      retiredDelivered = true;
    }
  });
  await delayed.getByRole("button", { name: "Connect", exact: true }).click();
  await expect.poll(() => retiredStarted).toBe(true);
  await connectionAction(delayed, "Disconnect");
  await delayed
    .getByLabel("Auth token", { exact: true })
    .fill("forget-me-token");
  await delayed.getByRole("button", { name: "Connect", exact: true }).click();
  await delayed
    .getByLabel("Server workspace path")
    .fill("/workspace/storage-check");
  await delayed
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await input.fill("New principal's input");
  await expect.poll(() => warnsOnLeave(delayed)).toBe(false);
  releaseRetired();
  await expect.poll(() => retiredDelivered).toBe(true);
  await expect(input).toHaveValue("New principal's input");
  await delayed.reload();
  await expect(input).toHaveValue("New principal's input");
});

test("failed Forget stays visible across identity edits until saved data can actually be cleared", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await page
    .getByRole("textbox", { name: "Message Octos" })
    .fill("A draft that must not silently return after Forget");
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === sessionStorage || this === localStorage)
        throw new DOMException("Read-only storage", "SecurityError");
      write.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === sessionStorage || this === localStorage)
        throw new DOMException("Read-only storage", "SecurityError");
      remove.call(this, key);
    };
    (window as unknown as { restoreStorage: () => void }).restoreStorage =
      () => {
        Storage.prototype.setItem = write;
        Storage.prototype.removeItem = remove;
      };
  });
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Forget server", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  const warning = page
    .getByRole("alert")
    .filter({ hasText: "Saved data could not be cleared" });
  await expect(warning).toBeVisible();
  expect(await warnsOnLeave(page)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toContain(
    "A draft that must not silently return",
  );
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("new-identity-token");
  await expect(warning).toBeVisible();
  expect(await warnsOnLeave(page)).toBe(true);
  await page.evaluate(() =>
    (window as unknown as { restoreStorage: () => void }).restoreStorage(),
  );
  await page
    .getByRole("button", { name: "Forget saved connection", exact: true })
    .click();
  await expect(warning).toHaveCount(0);
  expect(await warnsOnLeave(page)).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "A draft that must not silently return",
  );
  expect(errors).toEqual([]);
});

test("denied storage getters still allow an in-memory connection and readable cleanup feedback", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, key, {
        configurable: true,
        get() {
          throw new DOMException("Storage denied", "SecurityError");
        },
      });
    }
  });
  await start(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Saved data could not be cleared" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Octos" })
    .fill("Memory-only editing still works");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Memory-only editing still works");
  expect(await warnsOnLeave(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("a 51st unsent draft evicts the oldest, stays saved, and never blocks navigation", async ({
  page,
}) => {
  await start(page);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)!).draftPrincipal,
        TAB_KEY,
      ),
    )
    .toBe("fixture-user");
  await page.evaluate(
    ({ prefix, origin }) => {
      const scope = `${prefix}${JSON.stringify([origin, "fixture-user"])}:`;
      for (let index = 0; index < 50; index++) {
        const key = JSON.stringify([
          `/workspace/saved-${index}`,
          "_main",
          `session-${index}`,
        ]);
        localStorage.setItem(
          scope + key,
          JSON.stringify(`Retained text ${index}`),
        );
      }
    },
    { prefix: DRAFT_PREFIX, origin: ORIGIN },
  );
  await page.reload();
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await expect(input).toBeVisible();
  const draft = "The 51st draft stays here until I send, clear, or copy it";
  await input.fill(draft);
  const drafts = () =>
    page.evaluate(
      (prefix) =>
        Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)),
      DRAFT_PREFIX,
    );
  // The 51st draft is persisted to localStorage...
  await expect
    .poll(async () =>
      (await drafts()).some(([, value]) => JSON.parse(value) === draft),
    )
    .toBe(true);
  // ...and exactly one pre-existing draft was evicted to make room. (Which
  // one is the cache's oldest; localStorage enumeration order is opaque, so
  // the e2e assertion is that exactly one of the 50 is gone.)
  const retained = await drafts();
  expect(retained).toHaveLength(50);
  const texts = retained.map(([, value]) => JSON.parse(value) as string);
  const evicted = Array.from(
    { length: 50 },
    (_, index) => `Retained text ${index}`,
  ).filter((text) => !texts.includes(text));
  expect(evicted).toHaveLength(1);
  // A persisted draft shows no capacity warning and no beforeunload guard.
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "already keeps 50 unsent drafts" }),
  ).toHaveCount(0);
  await expect.poll(() => warnsOnLeave(page)).toBe(false);
  // Navigation is not blocked: the New session dialog opens...
  const sidebar = page.getByRole("complementary", {
    name: "Product navigation",
  });
  await sidebar
    .getByRole("button", { name: "New session", exact: true })
    .last()
    .click();
  const chooser = page.getByRole("dialog", {
    name: "Choose a workspace",
    exact: true,
  });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(input).toHaveValue(draft);
  // ...and a full reload restores the 51st draft.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue(draft);
});

test("a draft typed while identity loads is never the capacity eviction victim", async ({
  page,
}) => {
  await start(page);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)!).draftPrincipal,
        TAB_KEY,
      ),
    )
    .toBe("fixture-user");
  await page.evaluate(
    ({ prefix, origin }) => {
      const scope = `${prefix}${JSON.stringify([origin, "fixture-user"])}:`;
      for (let index = 0; index < 50; index++) {
        const key = JSON.stringify([
          `/workspace/saved-${index}`,
          "_main",
          `session-${index}`,
        ]);
        localStorage.setItem(
          scope + key,
          JSON.stringify(`Retained text ${index}`),
        );
      }
    },
    { prefix: DRAFT_PREFIX, origin: ORIGIN },
  );
  // Hold the identity lookup so the edit lands before hydration merges the
  // 50 stored drafts back into the cache. Only the first request is held;
  // later ones fulfill immediately with the same identity.
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = true;
  await page.route("**/api/auth/me", async (route) => {
    if (holding) {
      await held;
      holding = false;
    }
    await route.fulfill({ json: { user: { id: "fixture-user" } } });
  });
  await page.reload();
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await expect(input).toBeVisible();
  const draft = "Typed while the authenticated identity was still loading";
  await input.fill(draft);
  release();
  const drafts = () =>
    page.evaluate(
      (prefix) =>
        Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)),
      DRAFT_PREFIX,
    );
  // The fresh text is persisted...
  await expect
    .poll(async () =>
      (await drafts()).some(([, value]) => JSON.parse(value) === draft),
    )
    .toBe(true);
  // ...and the capacity eviction took exactly one stored draft instead.
  const retained = await drafts();
  expect(retained).toHaveLength(50);
  const texts = retained.map(([, value]) => JSON.parse(value) as string);
  const evicted = Array.from(
    { length: 50 },
    (_, index) => `Retained text ${index}`,
  ).filter((text) => !texts.includes(text));
  expect(evicted).toHaveLength(1);
  await expect(input).toHaveValue(draft);
});
