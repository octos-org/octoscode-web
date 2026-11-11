import { describe, expect, it } from "vitest";
import type { SkillPackage } from "@octos-org/octoscode-client/skills";
import {
  receiptMatchesPlan,
  reviewInstallDecision,
  reviewedInstallErrorKind,
  type InstallReview,
} from "./install-review.ts";

const COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);

function pkg(over: Partial<SkillPackage> = {}): SkillPackage {
  return {
    name: "sample",
    description: "Sample",
    repo: "org/sample",
    version: "1.0.0",
    author: null,
    license: null,
    skills: ["sample"],
    requires: [],
    providesTools: true,
    tags: [],
    installed: false,
    installedSkills: [],
    sourceCommit: COMMIT,
    reviewedAt: "2026-11-11T00:00:00Z",
    binaries: {
      "linux-x86_64": {
        url: "https://hub.example/linux.tar.gz",
        sha256: DIGEST,
        signature: "sig",
      },
    },
    ...over,
  };
}

function review(over: Partial<InstallReview> = {}): InstallReview {
  return {
    source: { repo: "org/sample", branch: "" },
    standing: "listed",
    package: pkg(),
    serverPlatform: "linux-x86_64",
    ...over,
  };
}

const gate = { methodOffered: true, featureNegotiated: true };

describe("reviewed install decision", () => {
  it("offers an install only for a negotiated capability and a fully pinned review", () => {
    // No capability: an older Core has no review-bound install at all.
    expect(
      reviewInstallDecision(review(), { ...gate, featureNegotiated: false }),
    ).toEqual({ ok: false, reason: "no-capability" });
    expect(
      reviewInstallDecision(review(), { ...gate, methodOffered: false }),
    ).toEqual({ ok: false, reason: "no-capability" });

    // Listed, pinned, and covered: the plan carries the exact review identity.
    const decision = reviewInstallDecision(review(), gate);
    expect(decision).toEqual({
      ok: true,
      plan: {
        package: "sample",
        repo: "org/sample",
        sourceCommit: COMMIT,
        reviewedAt: "2026-11-11T00:00:00Z",
        platform: "linux-x86_64",
        artifact: { sha256: DIGEST, signature: "sig" },
      },
    });

    // Source-only packages carry no artifact expectation.
    const sourceOnly = reviewInstallDecision(
      review({ package: pkg({ binaries: {}, providesTools: false }) }),
      gate,
    );
    expect(sourceOnly.ok && sourceOnly.plan.artifact).toBeNull();

    // Unlisted, unpinned, or host-uncovered reviews stay read-only.
    for (const [candidate, reason] of [
      [review({ standing: "unlisted", package: null }), "not-listed"],
      [review({ package: pkg({ sourceCommit: null }) }), "no-commit"],
      [review({ package: pkg({ reviewedAt: null }) }), "no-review-time"],
      [review({ serverPlatform: null }), "no-platform"],
      [review({ serverPlatform: "darwin-aarch64" }), "artifact-missing"],
      [
        review({
          package: pkg({
            binaries: {
              "linux-x86_64": { url: "u", sha256: null, signature: "sig" },
            },
          }),
        }),
        "artifact-incomplete",
      ],
    ] as const) {
      expect(reviewInstallDecision(candidate, gate)).toEqual({
        ok: false,
        reason,
      });
    }
  });

  it("accepts only a receipt that echoes the reviewed object", () => {
    const decision = reviewInstallDecision(review(), gate);
    if (!decision.ok) throw new Error("fixture must be installable");
    const receipt = {
      profileId: "main",
      installed: ["sample"],
      package: "sample",
      repo: "org/sample",
      sourceCommit: COMMIT,
      reviewedAt: "2026-11-11T00:00:00Z",
      platform: "linux-x86_64",
      artifactSha256: DIGEST,
      artifactBytes: 100,
    };
    expect(receiptMatchesPlan(decision.plan, receipt)).toBe(true);
    expect(
      receiptMatchesPlan(decision.plan, {
        ...receipt,
        sourceCommit: "c".repeat(40),
      }),
    ).toBe(false);
    expect(
      receiptMatchesPlan(decision.plan, { ...receipt, artifactSha256: null }),
    ).toBe(false);
  });

  it("maps only Core's typed refusal kinds, never a guessed one", () => {
    const error = Object.assign(new Error("nope"), {
      data: { kind: "reviewed_install_registry_mismatch" },
    });
    expect(reviewedInstallErrorKind(error)).toBe(
      "reviewed_install_registry_mismatch",
    );
    expect(
      reviewedInstallErrorKind(
        Object.assign(new Error("x"), { data: { kind: "unknown_kind" } }),
      ),
    ).toBeNull();
    expect(reviewedInstallErrorKind(new Error("plain"))).toBeNull();
  });
});
