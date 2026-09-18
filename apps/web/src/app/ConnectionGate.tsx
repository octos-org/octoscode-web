import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { SurfaceBoundary } from "../features/error/SurfaceBoundary.tsx";
import {
  ConnectionPanel,
  type ConnectionDraft,
} from "../features/connection/ConnectionPanel.tsx";
import {
  autoStartKind,
  initialConnection,
  STORAGE_CLEAR_WARNING,
} from "../features/connection/connection-bootstrap.ts";
import {
  browserStorage,
  clearConnectionPreferences,
  clearKnownSessions,
  loadAutoConnect,
  loadConnectionPreferences,
  loadDurableEndpoint,
  saveConnectionPreferences,
  setAutoConnect,
} from "../features/connection/preferences.ts";
import {
  claimPairingCode,
  consumePairingLink,
  loopbackOrigin,
  pairingErrorCopy,
  probePairingInfo,
  type PairingLink,
} from "../features/connection/pairing.ts";
import { clearRememberedTokens } from "../features/connection/remembered-token.ts";
import { clearRecentWorkspaces } from "../features/workspace/workspace-recents.ts";
import { useTheme, type ThemePreference } from "./use-theme.ts";

/**
 * The product shell. Everything an operator with a live server needs — the
 * session hook, transcript, composer, sidebar, settings, peers, fleet and
 * supervision — hangs off this one import, so an unconnected visitor never
 * downloads any of it. It is fetched the moment this tab has a server to talk
 * to, which is either a stored auto-start or the operator pressing Connect.
 */
const ProductShell = lazy(async () => ({
  default: (await import("./App.tsx")).App,
}));

const PreferencesDialog = lazy(async () => ({
  default: (await import("../features/preferences/PreferencesDialog.tsx"))
    .PreferencesDialog,
}));

/** The product shell's side of the connect screen: only it owns a session. */
export interface ConnectionGateBridge {
  /** Open (or re-open) the protocol connection with this draft. */
  readonly connect: (next: ConnectionDraft) => void;
  /** Close the connection and the surfaces that assume one. */
  readonly disconnect: () => void;
  /** Drop everything scoped to the identity being left. */
  readonly resetIdentity: () => void;
}

/**
 * The connect-screen props both owners render the panel with. The entry owns
 * every one of them; the shell adds only the three that need a live session
 * (`status`, `error`, and the classified-failure flags).
 */
export interface ConnectionPanelOwnedProps {
  readonly value: ConnectionDraft;
  readonly pairing: boolean;
  readonly pairingError: string | null;
  readonly discoveredOrigin: string | null;
  readonly onUseDiscovered: () => void;
  readonly onChange: (next: ConnectionDraft) => void;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onForget: () => void;
  readonly onPreferences: () => void;
  readonly storageWarning?: string;
}

/**
 * One source of truth for connection state. The entry reads storage exactly
 * once and hands the result down; the shell never reads it again.
 */
export interface ConnectionGateApi {
  readonly connection: ConnectionDraft;
  readonly setConnection: Dispatch<SetStateAction<ConnectionDraft>>;
  readonly pairingLink: PairingLink | null;
  readonly setPairingClaiming: Dispatch<SetStateAction<boolean>>;
  readonly cleanupFailed: boolean;
  /** This tab was already connected; the shell restores its Session. */
  readonly restoreConnectionRef: RefObject<boolean>;
  /** The shell publishes its session seam here while it is mounted. */
  readonly bridgeRef: RefObject<ConnectionGateBridge | null>;
  /** A connect the operator asked for before the shell finished loading. */
  readonly takePendingConnect: () => ConnectionDraft | null;
  /**
   * Hand a claimed draft back, for a shell that unmounts before its connect
   * could settle. Never overwrites a newer draft the operator has since parked.
   */
  readonly returnPendingConnect: (draft: ConnectionDraft) => void;
  readonly panel: ConnectionPanelOwnedProps;
  readonly disconnect: () => void;
  readonly forgetConnection: () => void;
  readonly theme: ThemePreference;
  readonly cycleTheme: () => void;
  readonly openPreferences: () => void;
}

/**
 * The first load: the connect screen, the pairing exchange, and the theme the
 * saved preference asks for — nothing else. The product shell is loaded once
 * this tab has a server to talk to, and inherits the connection state from
 * here rather than reading storage a second time.
 */
export function ConnectionGate() {
  // Applied before the first paint, so the connect screen is already in the
  // remembered theme rather than flashing the system one.
  const { theme, cycleTheme } = useTheme();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const restoreConnectionRef = useRef<boolean | null>(null);
  if (restoreConnectionRef.current === null) {
    restoreConnectionRef.current = loadAutoConnect(
      browserStorage("sessionStorage"),
    );
  }
  // WEB-PAIRING-CONTRACT-5100 §Client: main.tsx already read `octos`/`pair` and
  // rewrote the address before this first render; this reads what it captured.
  // The code lives only in memory.
  const [pairingLink] = useState(() => consumePairingLink());
  const [connection, setConnection] = useState(() => {
    const loaded = loadConnectionPreferences(
      initialConnection,
      browserStorage("localStorage"),
      browserStorage("sessionStorage"),
    );
    return pairingLink ? { ...loaded, token: "" } : loaded;
  });
  const pairingAbortRef = useRef<AbortController | null>(null);
  const [pairingClaiming, setPairingClaiming] = useState(Boolean(pairingLink));
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [discoveredOrigin, setDiscoveredOrigin] = useState<string | null>(null);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const bridgeRef = useRef<ConnectionGateBridge | null>(null);
  const pendingConnectRef = useRef<ConnectionDraft | null>(null);
  // The shell is fetched as soon as this tab would talk to a server without
  // being asked; otherwise not until the operator presses Connect.
  const [shellArmed, setShellArmed] = useState(
    () =>
      autoStartKind({
        pairingLink: pairingLink !== null,
        restoreConnection: restoreConnectionRef.current === true,
        endpoint: connection.endpoint,
        sessionId: connection.sessionId,
      }) !== null,
  );

  /**
   * Load the shell and connect. Before the shell has mounted the draft is
   * parked here and the shell claims it on mount, so a Connect pressed while
   * the chunk is still in flight is neither lost nor sent twice.
   */
  const requestConnect = (next: ConnectionDraft) => {
    setShellArmed(true);
    const bridge = bridgeRef.current;
    if (bridge) bridge.connect(next);
    else pendingConnectRef.current = next;
  };
  const takePendingConnect = () => {
    const pending = pendingConnectRef.current;
    pendingConnectRef.current = null;
    return pending;
  };
  const returnPendingConnect = (draft: ConnectionDraft) => {
    if (pendingConnectRef.current === null) pendingConnectRef.current = draft;
  };

  useEffect(() => {
    saveConnectionPreferences(
      connection,
      browserStorage("localStorage"),
      browserStorage("sessionStorage"),
    );
  }, [connection]);

  useEffect(() => {
    if (!clearRememberedTokens()) setCleanupFailed(true);
  }, []);

  // Pairing replaces the connection identity only while this claim is current.
  useEffect(() => {
    if (!pairingLink) return;
    const origin = loopbackOrigin(pairingLink.origin);
    if (!origin) {
      // Step 1: refused before any request is made, and the refused address is
      // NOT prefilled into the form the operator falls back to.
      setPairingError(pairingErrorCopy("pair_origin_not_loopback"));
      setPairingClaiming(false);
      return;
    }
    const controller = new AbortController();
    pairingAbortRef.current = controller;
    void claimPairingCode(pairingLink, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        pairingAbortRef.current = null;
        if (!result.ok) {
          changeConnection({ ...initialConnection, endpoint: origin });
          setPairingError(pairingErrorCopy(result.kind));
          setPairingClaiming(false);
          return;
        }
        const next = {
          ...initialConnection,
          endpoint: result.claim.serverOrigin,
          token: result.claim.token,
        };
        changeConnection(next);
        requestConnect(next);
      },
    );
    return () => controller.abort();
  }, [pairingLink]);

  // Probe only the last saved origin when this tab has no credential.
  useEffect(() => {
    if (pairingLink) return;
    if (restoreConnectionRef.current || connection.token.trim()) return;
    const last = loadDurableEndpoint(browserStorage("localStorage"));
    if (!last) return;
    const controller = new AbortController();
    let live = true;
    void probePairingInfo(last, { signal: controller.signal }).then((probe) => {
      if (live && probe.kind === "available") {
        setDiscoveredOrigin(probe.info.serverOrigin);
      }
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, []);

  const changeConnection = (next: ConnectionDraft) => {
    restoreConnectionRef.current = false;
    setAutoConnect(browserStorage("sessionStorage"), false);
    const identityChanged =
      next.endpoint !== connection.endpoint || next.token !== connection.token;
    if (identityChanged) {
      setPairingError(null);
      setDiscoveredOrigin(null);
      clearKnownSessions(browserStorage("sessionStorage"), connection);
      let cleared = clearRememberedTokens();
      if (
        !clearConnectionPreferences(
          browserStorage("localStorage"),
          browserStorage("sessionStorage"),
        )
      )
        cleared = false;
      for (const endpoint of new Set([
        connection.endpoint.trim(),
        next.endpoint.trim(),
      ])) {
        if (!endpoint) continue;
        if (!clearRecentWorkspaces(browserStorage("sessionStorage"), endpoint))
          cleared = false;
        if (!clearRecentWorkspaces(browserStorage("localStorage"), endpoint))
          cleared = false;
      }
      setCleanupFailed(!cleared);
      bridgeRef.current?.resetIdentity();
    }
    setConnection(
      identityChanged
        ? {
            ...next,
            sessionId: initialConnection.sessionId,
            profileId: "",
            cwd: "",
          }
        : next,
    );
  };
  const disconnect = () => {
    pairingAbortRef.current?.abort();
    pairingAbortRef.current = null;
    restoreConnectionRef.current = false;
    // Cancel is also the way out of an auto-start that has not reached the
    // shell yet: the parked connect and the unattended restore both stop here.
    pendingConnectRef.current = null;
    setPairingClaiming(false);
    setAutoConnect(browserStorage("sessionStorage"), false);
    bridgeRef.current?.disconnect();
  };
  const forgetConnection = () => {
    const rememberedCleared = clearRememberedTokens();
    setPairingError(null);
    setDiscoveredOrigin(null);
    clearKnownSessions(browserStorage("sessionStorage"), connection);
    const tabRecentsCleared = clearRecentWorkspaces(
      browserStorage("sessionStorage"),
      connection.endpoint,
    );
    const durableRecentsCleared = clearRecentWorkspaces(
      browserStorage("localStorage"),
      connection.endpoint,
    );
    bridgeRef.current?.resetIdentity();
    disconnect();
    setCleanupFailed(
      !clearConnectionPreferences(
        browserStorage("localStorage"),
        browserStorage("sessionStorage"),
      ) ||
        !rememberedCleared ||
        !tabRecentsCleared ||
        !durableRecentsCleared,
    );
    setConnection(initialConnection);
  };

  /** §Discovery: one button, one origin — the one that answered /pair/info. */
  const useDiscoveredOrigin = () => {
    if (!discoveredOrigin) return;
    const next = { ...initialConnection, endpoint: discoveredOrigin };
    setDiscoveredOrigin(null);
    changeConnection(next);
    requestConnect(next);
  };

  const panel: ConnectionPanelOwnedProps = {
    value: connection,
    pairing: pairingClaiming,
    pairingError,
    discoveredOrigin,
    onUseDiscovered: useDiscoveredOrigin,
    onChange: changeConnection,
    onConnect: () => requestConnect(connection),
    onDisconnect: disconnect,
    onForget: forgetConnection,
    onPreferences: () => setPreferencesOpen(true),
    ...(cleanupFailed ? { storageWarning: STORAGE_CLEAR_WARNING } : {}),
  };

  const gate: ConnectionGateApi = {
    connection,
    setConnection,
    pairingLink,
    setPairingClaiming,
    cleanupFailed,
    restoreConnectionRef: restoreConnectionRef as RefObject<boolean>,
    bridgeRef,
    takePendingConnect,
    returnPendingConnect,
    panel,
    disconnect,
    forgetConnection,
    theme,
    cycleTheme,
    openPreferences: () => setPreferencesOpen(true),
  };

  return (
    <>
      {preferencesOpen ? (
        <Suspense fallback={null}>
          <PreferencesDialog onClose={() => setPreferencesOpen(false)} />
        </Suspense>
      ) : null}
      {shellArmed ? (
        // The shell is loading because a connection is being opened, so the
        // wait reads as exactly that: the same panel, in the same connecting
        // state the operator would see once the socket is dialling.
        <Suspense
          fallback={
            <ConnectionPanel {...panel} status="connecting" error={null} />
          }
        >
          <ProductShell gate={gate} />
        </Suspense>
      ) : (
        <>
          <SurfaceBoundary name="Connection" fallback={null}>
            <ConnectionPanel {...panel} status="idle" error={null} />
          </SurfaceBoundary>
        </>
      )}
    </>
  );
}
