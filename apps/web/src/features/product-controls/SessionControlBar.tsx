/**
 * Session composer controls adapted from DeepSeek Harness' PermissionSelect,
 * ModelSelect, and InputBar at revision
 * b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
 * Copyright (c) 2026 DeepSeek, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import {
  modelSelectionIntent,
  permissionSelectionIntent,
} from "./selection-policy.ts";
import type {
  ControlState,
  ModelControlLabels,
  ModelProviderGroup,
  ModelSelection,
  PermissionControlLabels,
  PermissionRiskCopy,
  SessionPermissionOption,
} from "./types.ts";
import styles from "./SessionControlBar.module.css";
import { CheckIcon, ChevronDownIcon, ShieldIcon } from "../../ui/Icon.tsx";
import type { PermissionRuntimeState } from "../review/use-coding-safety.ts";
import {
  permissionControlState,
  permissionOptionId,
  permissionOptions,
} from "../shell/permission-projection.ts";
import { useUiText, type UiText } from "../preferences/ui-text.tsx";
import type {
  DriverInventoryDisclosure,
  DriverInventoryState,
} from "../session/driver-discovery.ts";
import type { SessionControlReadiness } from "../session/session-record-manager.ts";
import {
  PeerControlPanel,
  type PeerControlPanelState,
} from "../control/PeerControlPanel.tsx";
import type {
  PeerControlCommand,
  PeerControlFence,
  PeerControlLeaf,
  PeerControlTarget,
} from "../control/peer-control-commands.ts";
import {
  PeerControllerPanel,
  type PeerControllerPanelProps,
} from "../control/PeerControllerPanel.tsx";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <ChevronDownIcon className={open ? styles.chevronOpen : styles.chevron} />
  );
}

export interface PermissionControlProps {
  state: ControlState;
  options: readonly SessionPermissionOption[];
  selectedId: string | null;
  locked: boolean;
  labels: PermissionControlLabels;
  riskCopy: PermissionRiskCopy;
  onSelect: (option: SessionPermissionOption) => void;
  onRetry?: () => void;
}

export interface ModelControlProps {
  state: ControlState;
  groups: readonly ModelProviderGroup[];
  selected: ModelSelection | null;
  locked: boolean;
  labels: ModelControlLabels;
  onSelect: (selection: ModelSelection) => void;
  onRetry?: () => void;
}

export interface RuntimeModelControlProps {
  label: string | null;
  pendingProfileDefault?: string | undefined;
  onOpenSettings: () => void;
}

interface RuntimeSessionControlBarProps {
  ariaLabel: string;
  permissionState: PermissionRuntimeState;
  permissionLocked: boolean;
  onPermissionSelect: PermissionControlProps["onSelect"];
  onPermissionRetry: () => void;
  runtimeModel: RuntimeModelControlProps | null;
}

/** Pure display mapping lives with the already deferred composer controls. */
export function RuntimeSessionControlBar({
  ariaLabel,
  permissionState,
  permissionLocked,
  onPermissionSelect,
  onPermissionRetry,
  runtimeModel,
}: RuntimeSessionControlBarProps) {
  const currentPermission = permissionState.result?.current;
  const permission = permissionState.available
    ? {
        state: permissionControlState(permissionState),
        options: permissionOptions(permissionState.result),
        selectedId: currentPermission
          ? permissionOptionId(
              currentPermission.mode,
              currentPermission.network,
            )
          : null,
        locked:
          permissionLocked || permissionState.busy || !permissionState.editable,
        labels: PERMISSION_LABELS,
        riskCopy: PERMISSION_RISK_COPY,
        onSelect: onPermissionSelect,
        onRetry: onPermissionRetry,
      }
    : null;
  return (
    <SessionControlBar
      ariaLabel={ariaLabel}
      permission={permission}
      model={null}
      runtimeModel={runtimeModel}
    />
  );
}

const PERMISSION_LABELS = {
  menu: "Permission",
  loading: "Loading access…",
  unavailable: "Permission unavailable",
  select: "Permission",
  empty: "No permission presets are available.",
  retry: "Retry",
} as const;

const PERMISSION_RISK_COPY = {
  title: "Enable full access?",
  description:
    "Octos can read and modify files outside the workspace and use the network without the normal sandbox boundary.",
  accessLabel: "Filesystem access",
  networkLabel: "Network access",
  acknowledgement:
    "I understand that this session can make unrestricted changes.",
  cancel: "Cancel",
  confirm: "Enable full access",
} as const;

interface SessionControlBarBaseProps {
  ariaLabel: string;
  /** Null means the server did not advertise the permission capability. */
  permission: PermissionControlProps | null;
  /**
   * Read-only external-driver disclosure for the SELECTED record. Omitted, or
   * any non-complete state, exposes NO controller seat and no owner. This is
   * presentation of public server facts only, never execution authority.
   */
  driverInventory?: DriverInventoryState | undefined;
  /**
   * The external-master CONTROL seat (grant 0745). Mounted ONLY when the
   * selected record snapshot reports `readiness === "ready"` — i.e. caps admit
   * peer/control + external_driver_v1 AND an external binding is observed. The
   * leaf/fence/target are CALLER-held (never minted here) and the caller owns
   * the observable state; this bar is presentation, exactly like the permission
   * and model seats. Omitted ⇒ no control seat, no frames.
   */
  peerControl?: PeerControlSeat | undefined;
  /**
   * The peer CONTROLLER console (grant 2840). A SIBLING section of the control
   * seat: the seat drives an ALREADY-ACCEPTED peer, this console STAGES one. It
   * mounts under the SAME readiness gate as the seat, and the panel itself
   * re-gates on `peer/control` + `peer/dispatch`. Omitted ⇒ no console.
   */
  peerController?:
    | (PeerControllerPanelProps & {
        readonly readiness: SessionControlReadiness;
      })
    | undefined;
}

/**
 * One record's control seat, as resolved by the session command plumbing
 * (`useOctosSession`, features/session/use-octos-session.ts): its
 * `connection` snapshot already feeds `driverInventory` into this bar, and its
 * `protocol.client` is the shared transport the leaf is built from. Routing a
 * command is the caller's job — this bar only forwards the activation.
 */
export interface PeerControlSeat {
  /** The record snapshot's derived readiness; the ONLY mount gate here. */
  readonly readiness: SessionControlReadiness;
  /** Negotiated caps for the CURRENT authority (the panel re-gates on these). */
  readonly capabilities: UiProtocolCapabilities | undefined;
  /** The `peer/control` leaf, or null before one is built (null ⇒ no seat). */
  readonly leaf: PeerControlLeaf | null;
  /** Caller-held fence; the token is passed through, never rendered. */
  readonly fence: PeerControlFence;
  /** Caller-held target identity. */
  readonly target: PeerControlTarget;
  /** Observable state, owned by the caller. */
  readonly state: PeerControlPanelState;
  /** Activation sink; the bar never calls the leaf on render. */
  readonly onSend?: ((command: PeerControlCommand) => void) | undefined;
}

/**
 * The composer has one model seat. A server-effective runtime projection and
 * a true Session model selector are mutually exclusive product contracts.
 */
export type SessionControlBarProps = SessionControlBarBaseProps &
  (
    | {
        model: ModelControlProps;
        runtimeModel?: null | undefined;
      }
    | {
        model: null;
        /** Server-effective model; profile-scoped mutation lives in Settings. */
        runtimeModel?: RuntimeModelControlProps | null | undefined;
      }
  );

function useOutsideDismiss(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        dismissRef.current();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, rootRef]);
}

function permissionName(option: SessionPermissionOption): string {
  return `${option.modeLabel} · ${option.networkLabel}`;
}

interface PermissionMenuProps extends Omit<
  PermissionControlProps,
  "riskCopy" | "onSelect"
> {
  menuId: string;
  onChoose: (option: SessionPermissionOption) => void;
}

/** Exported for isolated rendering and accessibility tests. */
export function PermissionMenu({
  menuId,
  state,
  options,
  selectedId,
  locked,
  labels,
  onChoose,
  onRetry,
}: PermissionMenuProps) {
  return (
    <div
      id={menuId}
      className={`${styles.menu} ${styles.permissionMenu}`}
      role="menu"
      aria-label={labels.menu}
      aria-busy={state.status === "loading"}
    >
      {state.status === "loading" ? (
        <div className={styles.status}>{labels.loading}</div>
      ) : null}
      {state.status === "unavailable" ? (
        <div className={styles.status}>{labels.unavailable}</div>
      ) : null}
      {state.status === "error" ? (
        <ControlError
          message={state.message}
          retryLabel={labels.retry}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : null}
      <div className={styles.options}>
        {options.map((option) => {
          const selected = option.id === selectedId;
          const name = permissionName(option);
          return (
            <button
              key={option.id}
              type="button"
              className={styles.option}
              role="menuitemradio"
              aria-checked={selected}
              data-mode={option.mode}
              data-network={option.network}
              disabled={
                locked ||
                state.status === "unavailable" ||
                state.status === "loading"
              }
              onClick={() => onChoose(option)}
            >
              <span
                className={
                  option.risk === "dangerous"
                    ? `${styles.optionIcon} ${styles.danger}`
                    : styles.optionIcon
                }
              >
                <ShieldIcon dangerous={option.risk === "dangerous"} />
              </span>
              <span className={styles.optionCopy}>
                <span className={styles.optionName}>{name}</span>
                {option.description ? (
                  <span className={styles.optionDescription}>
                    {option.description}
                  </span>
                ) : null}
              </span>
              <span className={styles.optionCheck}>
                {selected ? <CheckIcon /> : null}
              </span>
            </button>
          );
        })}
      </div>
      {state.status === "ready" && options.length === 0 ? (
        <div className={styles.status}>{labels.empty}</div>
      ) : null}
    </div>
  );
}

interface RiskDialogProps {
  option: SessionPermissionOption;
  copy: PermissionRiskCopy;
  acknowledged: boolean;
  locked: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation is a separate blocking surface, never a menu-row side effect. */
export function PermissionRiskDialog({
  option,
  copy,
  acknowledged,
  locked,
  onAcknowledgedChange,
  onCancel,
  onConfirm,
}: RiskDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalSurface
      backdropClassName={styles.dialogBackdrop ?? ""}
      dialogClassName={styles.dialog ?? ""}
      labelledBy={titleId}
      describedBy={descriptionId}
      closeOnBackdrop
      onEscape={onCancel}
    >
      <div className={styles.dialogHeader}>
        <span className={styles.dialogWarning}>
          <ShieldIcon dangerous />
        </span>
        <h2 id={titleId}>{copy.title}</h2>
      </div>
      <p id={descriptionId} className={styles.dialogDescription}>
        {copy.description}
      </p>
      <dl className={styles.riskSummary}>
        <div>
          <dt>{copy.accessLabel}</dt>
          <dd>{option.modeLabel}</dd>
        </div>
        <div>
          <dt>{copy.networkLabel}</dt>
          <dd>{option.networkLabel}</dd>
        </div>
      </dl>
      <label className={styles.acknowledgement}>
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={locked}
          onChange={(event) =>
            onAcknowledgedChange(event.currentTarget.checked)
          }
        />
        <span>{copy.acknowledgement}</span>
      </label>
      <div className={styles.dialogActions}>
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={onCancel}
        >
          {copy.cancel}
        </button>
        <button
          type="button"
          className={styles.dangerAction}
          disabled={locked || !acknowledged}
          onClick={onConfirm}
        >
          {copy.confirm}
        </button>
      </div>
    </ModalSurface>
  );
}

export function PermissionControl(props: PermissionControlProps) {
  const { state, options, selectedId, locked, labels, riskCopy, onSelect } =
    props;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<SessionPermissionOption | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = options.find((option) => option.id === selectedId);
  const unavailable = state.status === "unavailable";
  const loading = state.status === "loading";
  const triggerDisabled =
    locked || unavailable || (loading && current === undefined);
  const label =
    current !== undefined
      ? permissionName(current)
      : loading
        ? labels.loading
        : unavailable
          ? labels.unavailable
          : labels.select;

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  };
  useOutsideDismiss(open, rootRef, closeMenu);

  useEffect(() => {
    if (!locked && !unavailable) return;
    setOpen(false);
    setPending(null);
    setAcknowledged(false);
  }, [locked, unavailable]);

  const choose = (option: SessionPermissionOption) => {
    const intent = permissionSelectionIntent(option, selectedId, locked);
    closeMenu();
    if (intent.kind === "confirm") {
      setAcknowledged(false);
      setPending(intent.option);
    } else if (intent.kind === "select") {
      onSelect(intent.option);
    }
  };

  const closeConfirmation = () => {
    setAcknowledged(false);
    setPending(null);
  };

  return (
    <>
      <div
        ref={rootRef}
        className={styles.control}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          closeMenu(true);
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          className={styles.trigger}
          aria-label={`${labels.menu}: ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={triggerDisabled}
          onClick={() => setOpen((value) => !value)}
        >
          <span
            className={
              current?.risk === "dangerous"
                ? `${styles.triggerIcon} ${styles.danger}`
                : styles.triggerIcon
            }
          >
            <ShieldIcon dangerous={current?.risk === "dangerous"} />
          </span>
          <span className={styles.triggerLabel}>{label}</span>
          {state.status === "error" ? (
            <span className={styles.errorDot} aria-hidden />
          ) : null}
          <ChevronIcon open={open} />
        </button>
        {open ? (
          <PermissionMenu
            state={state}
            options={options}
            selectedId={selectedId}
            locked={locked}
            labels={labels}
            menuId={menuId}
            onChoose={choose}
            {...(props.onRetry ? { onRetry: props.onRetry } : {})}
          />
        ) : null}
      </div>
      {pending ? (
        <PermissionRiskDialog
          option={pending}
          copy={riskCopy}
          acknowledged={acknowledged}
          locked={locked}
          onAcknowledgedChange={setAcknowledged}
          onCancel={closeConfirmation}
          onConfirm={() => {
            if (!acknowledged || locked) return;
            const option = pending;
            closeConfirmation();
            onSelect(option);
          }}
        />
      ) : null}
    </>
  );
}

interface ModelMenuProps extends Omit<ModelControlProps, "onSelect"> {
  menuId: string;
  onChoose: (
    providerId: string,
    model: ModelProviderGroup["models"][number],
  ) => void;
}

/** Exported grouped catalog surface; disabled entries remain explainable. */
export function ModelMenu({
  menuId,
  state,
  groups,
  selected,
  locked,
  labels,
  onChoose,
  onRetry,
}: ModelMenuProps) {
  const count = groups.reduce((total, group) => total + group.models.length, 0);
  return (
    <div
      id={menuId}
      className={`${styles.menu} ${styles.modelMenu}`}
      role="menu"
      aria-label={labels.menu}
      aria-busy={state.status === "loading"}
    >
      {state.status === "loading" ? (
        <div className={styles.status}>{labels.loading}</div>
      ) : null}
      {state.status === "unavailable" ? (
        <div className={styles.status}>{labels.unavailable}</div>
      ) : null}
      {state.status === "error" ? (
        <ControlError
          message={state.message}
          retryLabel={labels.retry}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : null}
      <div className={styles.modelGroups}>
        {groups.map((group) => {
          const headingId = `${menuId}-${group.id}`;
          return (
            <section
              key={group.id}
              className={styles.modelGroup}
              role="group"
              aria-labelledby={headingId}
            >
              <div id={headingId} className={styles.groupTitle}>
                {group.name}
              </div>
              {group.models.map((model) => {
                const selectedModel =
                  selected?.providerId === group.id &&
                  selected.modelId === model.id;
                const unavailableCopy = model.available
                  ? null
                  : model.unavailableReason;
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={styles.option}
                    role="menuitemradio"
                    aria-checked={selectedModel}
                    disabled={
                      locked ||
                      state.status === "unavailable" ||
                      !model.available
                    }
                    onClick={() => onChoose(group.id, model)}
                  >
                    <span className={styles.optionCopy}>
                      <span className={styles.optionName}>{model.name}</span>
                      {model.description || unavailableCopy ? (
                        <span className={styles.optionDescription}>
                          {unavailableCopy ?? model.description}
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.optionCheck}>
                      {selectedModel ? <CheckIcon /> : null}
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      {state.status === "ready" && count === 0 ? (
        <div className={styles.status}>{labels.empty}</div>
      ) : null}
    </div>
  );
}

export function ModelControl(props: ModelControlProps) {
  const { state, groups, selected, locked, labels, onSelect } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = groups
    .find((group) => group.id === selected?.providerId)
    ?.models.find((model) => model.id === selected?.modelId);
  const unavailable = state.status === "unavailable";
  const triggerLabel =
    current?.name ??
    (state.status === "loading"
      ? labels.loading
      : unavailable
        ? labels.unavailable
        : labels.select);

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  };
  useOutsideDismiss(open, rootRef, closeMenu);

  useEffect(() => {
    if (!locked && !unavailable) return;
    setOpen(false);
  }, [locked, unavailable]);

  const choose = (
    providerId: string,
    model: ModelProviderGroup["models"][number],
  ) => {
    const intent = modelSelectionIntent(providerId, model, selected, locked);
    if (intent.kind === "none") return;
    closeMenu(true);
    onSelect(intent.selection);
  };

  return (
    <div
      ref={rootRef}
      className={styles.control}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        closeMenu(true);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`${labels.menu}: ${triggerLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={locked || unavailable}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        {state.status === "error" ? (
          <span className={styles.errorDot} aria-hidden />
        ) : null}
        <ChevronIcon open={open} />
      </button>
      {open ? (
        <ModelMenu
          state={state}
          groups={groups}
          selected={selected}
          locked={locked}
          labels={labels}
          menuId={menuId}
          onChoose={choose}
          {...(props.onRetry ? { onRetry: props.onRetry } : {})}
        />
      ) : null}
    </div>
  );
}

interface ControlErrorProps {
  message: string;
  retryLabel: string;
  onRetry?: () => void;
}

function ControlError({ message, retryLabel, onRetry }: ControlErrorProps) {
  return (
    <div className={styles.error} role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Stable composer row: permissions occupy the left seat and the model occupies
 * the right seat. Missing capabilities remove their seat instead of exposing
 * a dead product control.
 */
const MS_DATE_MAX = 8_640_000_000_000_000;

/**
 * Neutral lease copy. Zero is the ONLY "no active lease" case; a positive
 * lease is never rendered as live and never throws — a finite in-range value
 * gets an ISO timestamp, an out-of-range/non-finite wire u64 falls back to its
 * raw value instead of a false "no lease" claim.
 */
function leaseCopy(leaseExpiresAtMs: number, t: UiText): string {
  if (leaseExpiresAtMs <= 0) return t("No active lease");
  const shown =
    Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs <= MS_DATE_MAX
      ? new Date(leaseExpiresAtMs).toISOString()
      : String(leaseExpiresAtMs);
  return t("Lease expires {value0}", { value0: shown });
}

/**
 * Read-only, keyboard-native controller disclosure. Only the four public
 * disclosure fields are read: `mode` is authoritative (a zero-lease external
 * stays external), `recovery` is the untruncated union, and the binding is
 * rendered only when present. No control token, workspace path, raw RPC map,
 * or non-whitelisted extra is ever spread or rendered.
 */
function DriverControllerDisclosure({
  disclosure,
}: {
  disclosure: DriverInventoryDisclosure;
}) {
  const t = useUiText();
  const mode =
    disclosure.mode === "external"
      ? t("External controller")
      : t("Internal controller");
  const recovery =
    disclosure.recovery === "interrupted"
      ? t("Interrupted")
      : disclosure.recovery === "recovery_required"
        ? t("Recovery required")
        : t("No recovery pending");
  const binding = disclosure.binding;
  return (
    <details
      className={styles.disclosure}
      data-control-disclosure="driver"
      aria-label={t("Session controller")}
    >
      <summary className={styles.disclosureSummary}>{mode}</summary>
      <dl className={styles.disclosureFacts}>
        <div className={styles.disclosureRow}>
          <dt>{t("Recovery")}</dt>
          <dd>{recovery}</dd>
        </div>
        {binding ? (
          <>
            <div className={styles.disclosureRow}>
              <dt>{t("Driver")}</dt>
              <dd className={styles.disclosureValue}>{binding.driverId}</dd>
            </div>
            <div className={styles.disclosureRow}>
              <dt>{t("Epoch")}</dt>
              <dd>{String(binding.epoch)}</dd>
            </div>
            <div className={styles.disclosureRow}>
              <dt>{t("Revision")}</dt>
              <dd>{String(binding.revision)}</dd>
            </div>
            <div className={styles.disclosureRow}>
              <dt>{t("Lease")}</dt>
              <dd>{leaseCopy(binding.leaseExpiresAtMs, t)}</dd>
            </div>
          </>
        ) : null}
      </dl>
    </details>
  );
}

export function SessionControlBar({
  ariaLabel,
  permission,
  model,
  runtimeModel = null,
  driverInventory,
  peerControl,
  peerController,
}: SessionControlBarProps) {
  const t = useUiText();
  const disclosure =
    driverInventory?.kind === "complete" ? driverInventory.disclosure : null;
  if (
    permission === null &&
    model === null &&
    runtimeModel === null &&
    disclosure === null
  )
    return null;
  const runtimeLabel = runtimeModel?.label?.trim() || "not reported";
  const pendingRestartCopy = runtimeModel?.pendingProfileDefault
    ? ` Profile default ${runtimeModel.pendingProfileDefault} is pending an Octos restart.`
    : "";
  return (
    <div className={styles.bar} role="toolbar" aria-label={ariaLabel}>
      {permission ? (
        <div className={styles.leftSeat} data-control-seat="permission">
          <PermissionControl {...permission} />
        </div>
      ) : null}
      {disclosure ? (
        <div className={styles.controllerSeat} data-control-seat="driver">
          <DriverControllerDisclosure disclosure={disclosure} />
        </div>
      ) : null}
      {peerControl && peerControl.readiness === "ready" ? (
        <div className={styles.controllerSeat} data-control-seat="peer">
          <PeerControlPanel
            capabilities={peerControl.capabilities}
            leaf={peerControl.leaf}
            fence={peerControl.fence}
            target={peerControl.target}
            state={peerControl.state}
            {...(peerControl.onSend ? { onSend: peerControl.onSend } : {})}
          />
        </div>
      ) : null}
      {peerController && peerController.readiness === "ready" ? (
        <div
          className={styles.controllerSeat}
          data-control-seat="peer-controller"
        >
          <PeerControllerPanel
            capabilities={peerController.capabilities}
            lanePicker={peerController.lanePicker}
            seatHeld={peerController.seatHeld}
            binding={peerController.binding}
            roster={peerController.roster}
            state={peerController.state}
            {...(peerController.onDispatch
              ? { onDispatch: peerController.onDispatch }
              : {})}
            {...(peerController.onReleaseSeat
              ? { onReleaseSeat: peerController.onReleaseSeat }
              : {})}
            {...(peerController.seatReleased ? { seatReleased: true } : {})}
            {...(peerController.onAcquireSeat
              ? { onAcquireSeat: peerController.onAcquireSeat }
              : {})}
            {...(peerController.onRowAction
              ? { onRowAction: peerController.onRowAction }
              : {})}
          />
        </div>
      ) : null}
      {runtimeModel || model ? (
        <div className={styles.rightSeat} data-control-seat="model">
          {runtimeModel ? (
            <button
              type="button"
              className={styles.trigger}
              aria-label={t("Runtime model: {value0}.{value1} Open Settings.", {
                value0: String(runtimeLabel),
                value1: String(pendingRestartCopy),
              })}
              aria-haspopup="dialog"
              title={t("The model reported by this Session runtime.")}
              onClick={runtimeModel.onOpenSettings}
            >
              <span className={styles.triggerLabel}>
                {runtimeLabel === "not reported"
                  ? t("Runtime not reported")
                  : runtimeLabel}
              </span>
              {runtimeModel.pendingProfileDefault ? (
                <span
                  className={styles.pendingDot}
                  title={t(
                    "Profile default {value0} is pending an Octos restart",
                    { value0: String(runtimeModel.pendingProfileDefault) },
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          ) : model ? (
            <ModelControl {...model} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
