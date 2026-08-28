import type { ReactNode } from "react";

/**
 * Presentation contracts for the session-level controls.
 *
 * These types intentionally contain no Octos method names. The product adapter
 * projects server-advertised capabilities and confirmed runtime state into
 * these props; the controls only render that projection and report intent.
 */

export type ControlState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

export interface SessionPermissionOption {
  /** Stable server-provided identity for this whole preset. */
  id: string;
  /** Server vocabulary, retained so the adapter can submit the exact option. */
  mode: string;
  /** Network policy belonging to this preset; it is never changed separately. */
  network: string;
  /** Human-facing filesystem/mode label. */
  modeLabel: string;
  /** Human-facing network label. */
  networkLabel: string;
  /** Optional server-provided explanation shown in the menu. */
  description?: string;
  /** Required fail-closed risk classification. */
  risk: "standard" | "dangerous";
}

export interface PermissionControlLabels {
  menu: string;
  loading: string;
  unavailable: string;
  select: string;
  empty: string;
  retry: string;
}

export interface PermissionRiskCopy {
  title: string;
  description: string;
  accessLabel: string;
  networkLabel: string;
  acknowledgement: string;
  cancel: string;
  confirm: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  /** False keeps a catalog entry visible but impossible to submit. */
  available: boolean;
  unavailableReason?: string;
}

export interface ModelProviderGroup {
  id: string;
  name: string;
  models: readonly ModelOption[];
}

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface ModelControlLabels {
  menu: string;
  loading: string;
  unavailable: string;
  select: string;
  empty: string;
  retry: string;
}

export type SettingsSectionId = "general" | "models";

export interface SettingsLabels {
  title: string;
  navigation: string;
  general: string;
  models: string;
  close: string;
}

export interface SettingsSlots {
  general: ReactNode;
  models?: ReactNode;
}
