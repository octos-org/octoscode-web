import { expect, type APIRequestContext } from "@playwright/test";
import { FIXTURE_ORIGIN } from "./fixture-session";

/** The fixture holds the terminal of each of the next `count` turns to start. */
export async function holdTerminals(
  request: APIRequestContext,
  count = 1,
): Promise<void> {
  for (let index = 0; index < count; index += 1)
    expect(
      (
        await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/hold-next`)
      ).status(),
    ).toBe(204);
}

/** Waits until the fixture is holding a terminal for `sessionId`. */
export async function terminalHeld(
  request: APIRequestContext,
  sessionId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = (await (
          await request.get(`${FIXTURE_ORIGIN}/__test__/terminal/state`)
        ).json()) as { held: { session_id: string }[] };
        return state.held.map((held) => held.session_id);
      },
      { timeout: 20_000 },
    )
    .toContain(sessionId);
}

/** Releases `sessionId`'s held terminal once the fixture is holding one. */
export async function releaseTerminal(
  request: APIRequestContext,
  sessionId: string,
): Promise<void> {
  await terminalHeld(request, sessionId);
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/terminal/release?session_id=${encodeURIComponent(sessionId)}`,
      )
    ).status(),
  ).toBe(204);
}

/** Drops every socket the fixture holds, as a network blip would. */
export async function disconnect(request: APIRequestContext): Promise<void> {
  expect(
    (await request.post(`${FIXTURE_ORIGIN}/__test__/disconnect`)).status(),
  ).toBe(204);
}
