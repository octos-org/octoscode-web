export interface SessionConnectionInput {
  endpoint: string;
  token: string;
  sessionId: string;
  profileId: string;
  cwd: string;
}

export interface ReconnectPlan {
  attempt: number;
  delayMs: number;
  config: SessionConnectionInput;
}

type RandomSource = () => number;

/**
 * Synchronous authority for connection intent.
 *
 * React state describes presentation; OctosUiClient describes the socket. This
 * object owns the small set of decisions that async callbacks must read
 * synchronously: manual versus unexpected closure, active connection input,
 * launch resolution, session establishment, and retry progression.
 */
export class SessionConnectionLifecycle {
  private activeConfig: SessionConnectionInput | null = null;
  private manual = true;
  private retryAttempt = 0;
  private established = false;
  private launchResolutionPending = false;

  constructor(private readonly random: RandomSource = Math.random) {}

  get config(): SessionConnectionInput | null {
    return this.activeConfig;
  }

  get sessionEstablished(): boolean {
    return this.established;
  }

  /** Prevent a superseded client's close callback from scheduling a retry. */
  suspend(): void {
    this.manual = true;
  }

  begin(
    input: SessionConnectionInput,
    resolveWorkspaceLaunch: boolean,
  ): SessionConnectionInput {
    const config = normalizeConnectionInput(input);
    this.activeConfig = config;
    this.manual = false;
    this.retryAttempt = 0;
    this.established = false;
    this.launchResolutionPending =
      resolveWorkspaceLaunch && Boolean(config.cwd);
    return config;
  }

  updateConfig(config: SessionConnectionInput): void {
    this.activeConfig = config;
  }

  shouldResolveLaunch(reconnecting: boolean): boolean {
    return this.launchResolutionPending && !(reconnecting && this.established);
  }

  markLaunchResolved(): void {
    this.launchResolutionPending = false;
  }

  markSessionEstablished(config: SessionConnectionInput): void {
    this.activeConfig = config;
    this.established = true;
    this.retryAttempt = 0;
  }

  stopRetrying(): void {
    this.manual = true;
  }

  nextReconnect(): ReconnectPlan | null {
    if (this.manual || !this.activeConfig) return null;
    const attempt = this.retryAttempt + 1;
    this.retryAttempt = attempt;
    const baseDelay = Math.min(500 * 2 ** Math.min(attempt - 1, 4), 5_000);
    const jitter = 0.8 + clampUnit(this.random()) * 0.4;
    return {
      attempt,
      delayMs: Math.round(baseDelay * jitter),
      config: this.activeConfig,
    };
  }

  disconnect(): void {
    this.manual = true;
    this.activeConfig = null;
    this.retryAttempt = 0;
    this.established = false;
    this.launchResolutionPending = false;
  }
}

function normalizeConnectionInput(
  input: SessionConnectionInput,
): SessionConnectionInput {
  return {
    endpoint: input.endpoint.trim(),
    token: input.token,
    sessionId: input.sessionId.trim(),
    profileId: input.profileId.trim(),
    cwd: input.cwd.trim(),
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
