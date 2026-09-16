/**
 * fleet-navigation — the Fleet navigation entry descriptor for the strip owner
 * (program WEB-UX-PROGRAM-4000: "exports FleetView + a nav entry descriptor
 * that ux-strip-01 mounts"; grant GLM-WEB-UX2-FLEET-VIEW-4010).
 *
 * PURE data. The strip owner mounts this entry next to Settings; nothing here
 * imports App or the strip, so there is no ownership edge back up the tree.
 */

/** A product navigation entry another surface (the strip owner) mounts. */
export interface FleetNavigationEntry {
  /** The visible label ("Fleet"). */
  readonly label: string;
  /** A visible glyph (never color-only — §8). */
  readonly icon: string;
  /** The stable route key the strip switches on. */
  readonly routeKey: string;
}

/** The ONE descriptor the strip owner mounts next to Settings. */
export const fleetNavigationEntry: FleetNavigationEntry = Object.freeze({
  label: "Fleet",
  icon: "✦",
  routeKey: "fleet",
});
