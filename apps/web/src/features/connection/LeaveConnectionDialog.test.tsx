import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LeaveConnectionDialog } from "./LeaveConnectionDialog.tsx";

describe("LeaveConnectionDialog", () => {
  it.each(["disconnect", "forget"] as const)(
    "explains the work loss before an explicit %s action",
    (action) => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();
      const html = renderToStaticMarkup(
        <LeaveConnectionDialog
          action={action}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      );
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain("aria-labelledby=");
      expect(html).toContain("aria-describedby=");
      expect(html).toContain("Current and background work may stop");
      expect(html).toContain("Queued messages will be discarded.");
      expect(html).toContain(">Cancel</button>");
      expect(html).toContain(
        action === "forget"
          ? ">Forget server</button>"
          : ">Disconnect</button>",
      );
      expect(html).toContain(
        action === "forget"
          ? "removes the saved server address"
          : "server stays remembered",
      );
      expect(onCancel).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );
});
