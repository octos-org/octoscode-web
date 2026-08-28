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

interface SessionControlBarBaseProps {
  ariaLabel: string;
  /** Null means the server did not advertise the permission capability. */
  permission: PermissionControlProps | null;
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? styles.chevronOpen : styles.chevron}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 5.25 7 8.75l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m3.4 8.2 2.8 2.8 6.4-6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon({ dangerous }: { dangerous: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.1 14 3.35v3.32c0 4.55-3.42 6.57-6 7.56-2.58-.99-6-3.01-6-7.56V3.35L8 1.1Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      {dangerous ? (
        <path
          d="M8.7 4.5v4H7.3v-4h1.4Zm0 5v1.5H7.3V9.5h1.4Z"
          fill="currentColor"
        />
      ) : (
        <path
          d="m5 7.8 1.9 1.9L11.2 5"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

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
export function SessionControlBar({
  ariaLabel,
  permission,
  model,
  runtimeModel = null,
}: SessionControlBarProps) {
  if (permission === null && model === null && runtimeModel === null)
    return null;
  const runtimeLabel = runtimeModel?.label?.trim() || "not reported";
  const pendingRestartCopy = runtimeModel?.pendingProfileDefault
    ? ` Profile default ${runtimeModel.pendingProfileDefault} is pending an Octos restart.`
    : "";
  return (
    <div className={styles.bar} aria-label={ariaLabel}>
      {permission ? (
        <div className={styles.leftSeat} data-control-seat="permission">
          <PermissionControl {...permission} />
        </div>
      ) : null}
      {runtimeModel || model ? (
        <div className={styles.rightSeat} data-control-seat="model">
          {runtimeModel ? (
            <button
              type="button"
              className={styles.trigger}
              aria-label={`Runtime model: ${runtimeLabel}.${pendingRestartCopy} Open Settings.`}
              aria-haspopup="dialog"
              title="The model reported by this Session runtime."
              onClick={runtimeModel.onOpenSettings}
            >
              <span className={styles.triggerLabel}>
                {runtimeLabel === "not reported"
                  ? "Runtime not reported"
                  : runtimeLabel}
              </span>
              {runtimeModel.pendingProfileDefault ? (
                <span
                  className={styles.pendingDot}
                  title={`Profile default ${runtimeModel.pendingProfileDefault} is pending an Octos restart`}
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
