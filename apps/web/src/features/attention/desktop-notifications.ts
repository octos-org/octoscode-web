import type { AttentionState } from "./model.ts";

const PREFERENCE_KEY = "octoscode-web:desktop-notifications";
const DEFAULT_MESSAGE =
  "Notify when a background response finishes or needs input. Tab counts are always on.";

export interface AttentionSettings {
  enabled: boolean;
  pending: boolean;
  available: boolean;
  message: string;
  error: boolean;
  onToggle: () => void;
}

type Notice = { close(): void; onclick: ((event: Event) => void) | null };
export interface DesktopEnvironment {
  permission(): NotificationPermission | null;
  requestPermission(): Promise<NotificationPermission>;
  create(body: string): Notice;
  focus(): void;
  readPreference(): boolean;
  savePreference(enabled: boolean): void;
}

/** No permission request occurs until the Settings action is explicitly used. */
export class DesktopNotifications {
  #listeners = new Set<() => void>();
  #notice: Notice | null = null;
  #request = 0;
  #settings: AttentionSettings;

  constructor(private readonly environment: DesktopEnvironment) {
    const permission = environment.permission();
    this.#settings = {
      enabled: environment.readPreference() && permission === "granted",
      pending: false,
      available: permission !== null,
      message:
        permission === null
          ? "Desktop notifications are unavailable here. Tab counts still work."
          : DEFAULT_MESSAGE,
      error: false,
      onToggle: () => void this.toggle(),
    };
  }

  getSnapshot = (): AttentionSettings => this.#settings;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async toggle(): Promise<void> {
    if (this.#settings.pending || !this.#settings.available) return;
    if (this.#settings.enabled) {
      this.#request++;
      this.clear();
      this.#save(false, DEFAULT_MESSAGE);
      return;
    }
    const request = ++this.#request;
    this.#update({ pending: true, error: false });
    try {
      const permission = await this.environment.requestPermission();
      if (request !== this.#request) return;
      this.#save(
        permission === "granted",
        permission === "granted"
          ? "Desktop notifications are on. Tab counts remain available."
          : permission === "denied"
            ? "Notifications are blocked. Allow them in browser site settings to enable them here. Tab counts still work."
            : "Permission was not granted. You can enable notifications later. Tab counts still work.",
        permission !== "granted",
      );
    } catch {
      if (request !== this.#request) return;
      this.#save(
        false,
        "Could not enable desktop notifications. Tab counts still work; try again when browser permissions are available.",
        true,
      );
    }
  }

  show(state: AttentionState): void {
    if (!this.#settings.enabled) return;
    try {
      if (this.environment.permission() !== "granted") {
        this.#save(
          false,
          "Notification permission changed. Tab counts still work.",
          true,
        );
        return;
      }
      this.clear();
      const body =
        state === "waiting"
          ? "A background response needs your input. Return to Octoscode to review it."
          : state === "failed"
            ? "A background response needs attention. Return to Octoscode to review it."
            : "A background response finished. Return to Octoscode to review it.";
      this.#notice = this.environment.create(body);
      this.#notice.onclick = () => {
        this.environment.focus();
        this.clear();
      };
    } catch {
      this.#save(
        false,
        "This browser could not show a desktop notification. Tab counts still work.",
        true,
      );
    }
  }

  clear(): void {
    try {
      this.#notice?.close();
    } catch {
      // An expired OS notification must not affect the running Session.
    }
    this.#notice = null;
  }

  dispose(): void {
    this.#request++;
    this.clear();
  }

  #save(enabled: boolean, message: string, error = false): void {
    this.environment.savePreference(enabled);
    this.#update({ enabled, pending: false, message, error });
  }

  #update(patch: Partial<AttentionSettings>): void {
    this.#settings = { ...this.#settings, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

export function desktopEnvironment(
  browser: Window & typeof globalThis = window,
): DesktopEnvironment {
  return {
    permission: () => {
      try {
        return typeof browser.Notification === "function"
          ? browser.Notification.permission
          : null;
      } catch {
        return null;
      }
    },
    requestPermission: () => browser.Notification.requestPermission(),
    create: (body) =>
      new browser.Notification("Octoscode", {
        body,
        tag: "octoscode-attention",
      }),
    focus: () => browser.focus(),
    readPreference: () => {
      try {
        return browser.localStorage.getItem(PREFERENCE_KEY) === "true";
      } catch {
        return false;
      }
    },
    savePreference: (enabled) => {
      try {
        browser.localStorage.setItem(PREFERENCE_KEY, String(enabled));
      } catch {
        // This preference can stay in memory when browser storage is blocked.
      }
    },
  };
}
