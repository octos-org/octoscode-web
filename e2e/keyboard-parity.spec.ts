import { expect, test, type Page } from "@playwright/test";

import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import { observeFrames } from "./turn-observers";

/**
 * Keyboard-parity e2e — parity targets cited from the native TUI keymap
 * (reference-tui-0a174d95/src/event_loop.rs):
 *   • Command palette: ArrowDown/ArrowUp move the selection and Enter dispatches
 *     the highlighted item — TUI `move_down`/`move_up` (:3255-3291) and the
 *     menu accept path (:2615, :2691).
 *   • Esc: interrupts ONLY when a turn is live (:2013-2022); otherwise it walks
 *     the close/focus ladder and never interrupts (:1978-2038). On the slash
 *     popup Esc dismisses the menu (:2631-2649).
 *
 * DELIBERATELY MOUSE-FREE: no `.click()`/`.hover()` anywhere. Setup uses
 * `fill` + `press("Enter")`; all navigation/activation is `keyboard.press`.
 * Locators under an open modal are CSS: `ModalSurface` sets `aria-hidden="true"`
 * on the `<main>` that wraps the sidebar (App.tsx:1171, ModalSurface.tsx:50-60),
 * which hides it from ROLE queries — the class 0520 hardened elsewhere.
 */

const PALETTE_ID = "composer-command-palette";

const composer = (page: Page) => page.locator(".composer textarea");
const palette = (page: Page) => page.locator(".command-palette");

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
  await request.post(`${FIXTURE_ORIGIN}/__test__/turn-start/reset`);
});

test("opens, navigates, and executes the command palette by keyboard only", async ({
  page,
}) => {
  const w = observeFrames(page);
  await connectAndStartWorkspace(page, "/srv/work/keyboard-palette");
  const input = composer(page);
  await input.focus(); // programmatic focus, no mouse

  // Open by typing the slash trigger (registry.ts:660 commandSuggestions).
  await input.press("/");
  await expect(palette(page)).toBeVisible();
  const options = palette(page).locator('[role="option"]');
  await expect(options).not.toHaveCount(0);

  // The textbox exposes its suggestions without surrendering editing focus.
  await expect(input).toHaveAttribute("aria-haspopup", "listbox");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-controls", PALETTE_ID);
  const firstId = (await options.first().getAttribute("id"))!;
  await expect(input).toHaveAttribute("aria-activedescendant", firstId);

  // Navigate: ArrowDown advances the selection without touching the draft
  // (ComposerInput.tsx:96-111 → onCommandMove; TUI parity move_down :3255).
  await input.press("ArrowDown");
  const secondId = (await options.nth(1).getAttribute("id"))!;
  await expect(input).toHaveAttribute("aria-activedescendant", secondId);
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(options.first()).toHaveAttribute("aria-selected", "false");

  // ArrowUp retreats, and wraps past the top to the last option
  // (App.tsx:1511-1517 modulo move; TUI move_up :3272).
  await input.press("ArrowUp");
  await expect(input).toHaveAttribute("aria-activedescendant", firstId);
  await input.press("ArrowUp");
  const lastId = (await options.last().getAttribute("id"))!;
  await expect(input).toHaveAttribute("aria-activedescendant", lastId);
  await expect(options.last()).toBeInViewport({ ratio: 1 });
  await input.press("Shift+Tab");
  await expect(options.last()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(options.first()).toBeFocused();
  await expect(options.first()).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();
  await expect(palette(page)).toHaveCount(0);

  // Execute: filter to a known local command and dispatch it with Enter
  // (ComposerInput.tsx:167-174 onSubmit → App.tsx chooseCommand = submit("/x")).
  await input.fill("/theme");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    `${PALETTE_ID}-theme`,
  );
  await input.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(
    page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: /^Browser preferences$/ }),
    }),
  ).toBeVisible();
  // A local command never starts a model turn.
  expect(w.calls("turn/start")).toHaveLength(0);
});
