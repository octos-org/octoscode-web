import type { Page } from "@playwright/test";

/**
 * A stand-in for the browser's Notification API and page visibility, so a
 * spec can see which desktop notifications the app raised and click them.
 */
export interface AttentionProbe {
  hidden: boolean;
  permission: NotificationPermission;
  result: NotificationPermission;
  requests: number;
  notices: { title: string; body: string; closed: boolean }[];
  /** Clicks the `index`th notification, as the person would. */
  click(index: number): void;
}
declare global {
  interface Window {
    __attentionProbe: AttentionProbe;
  }
}

/**
 * `result` answers a permission request. `enabled` starts with permission
 * granted and desktop notifications already switched on.
 */
export async function instrument(
  page: Page,
  result: NotificationPermission = "granted",
  enabled = false,
) {
  await page.addInitScript(
    ([permissionResult, alreadyEnabled]) => {
      const shown: BrowserNotification[] = [];
      const state: AttentionProbe = {
        hidden: false,
        permission: alreadyEnabled ? "granted" : "default",
        result: permissionResult,
        requests: 0,
        notices: [],
        click: (index) => shown[index]?.onclick?.(new Event("click")),
      };
      if (alreadyEnabled)
        localStorage.setItem("octoscode-web:desktop-notifications", "true");
      window.__attentionProbe = state;
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (state.hidden ? "hidden" : "visible"),
      });
      class BrowserNotification {
        static get permission() {
          return state.permission;
        }
        static async requestPermission() {
          state.requests++;
          state.permission = state.result;
          return state.result;
        }
        readonly notice: AttentionProbe["notices"][number];
        onclick: ((event: Event) => void) | null = null;
        constructor(title: string, options: NotificationOptions) {
          this.notice = { title, body: options.body ?? "", closed: false };
          state.notices.push(this.notice);
          shown.push(this);
        }
        close() {
          this.notice.closed = true;
        }
      }
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: BrowserNotification,
      });
    },
    [result, enabled] as const,
  );
}

/** Hides or shows the page, as switching tabs would. */
export async function hidden(page: Page, value: boolean) {
  await page.evaluate((next) => {
    window.__attentionProbe.hidden = next;
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}
