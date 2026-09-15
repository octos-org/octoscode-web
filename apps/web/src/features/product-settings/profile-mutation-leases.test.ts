import { describe, expect, it, vi } from "vitest";
import { ProfileMutationLeases } from "./profile-mutation-leases.ts";
describe("Profile mutation lifetime", () => {
  it("holds ownership independently of the modal and rejects duplicate acquisition", () => {
    const changed = vi.fn();
    const leases = new ProfileMutationLeases(changed);
    const release = leases.acquire("endpoint-profile-A");
    expect(leases.held("endpoint-profile-A")).toBe(true);
    expect(() => leases.acquire("endpoint-profile-A")).toThrow(
      "already pending",
    );
    const releaseOther = leases.acquire("endpoint-profile-B");
    releaseOther();
    expect(leases.held("endpoint-profile-A")).toBe(true);
    release();
    release();
    expect(leases.held("endpoint-profile-A")).toBe(false);
    expect(changed).toHaveBeenCalledTimes(4);
  });
});
