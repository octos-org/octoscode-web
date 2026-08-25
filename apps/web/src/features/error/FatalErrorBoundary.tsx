import { Component, useState, type ErrorInfo, type ReactNode } from "react";

interface FatalErrorBoundaryProps {
  children: ReactNode;
}

interface FatalErrorBoundaryState {
  report: string | null;
}

export class FatalErrorBoundary extends Component<
  FatalErrorBoundaryProps,
  FatalErrorBoundaryState
> {
  override state: FatalErrorBoundaryState = { report: null };

  static getDerivedStateFromError(error: unknown): FatalErrorBoundaryState {
    return { report: buildSafeDiagnostic(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({
      report: buildSafeDiagnostic(error, info.componentStack ?? ""),
    });
  }

  override render() {
    return this.state.report ? (
      <FatalCrashScreen report={this.state.report} />
    ) : (
      this.props.children
    );
  }
}

export function FatalCrashScreen({ report }: { report: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <main className="fatal-shell" role="alert">
      <section className="fatal-card">
        <div className="brand-mark">O</div>
        <span className="eyebrow">Octoscode Web stopped rendering</span>
        <h1>Reload the client safely</h1>
        <p>
          Agent execution and durable session state remain in Octos. Reloading
          discards only unsent text in this browser tab.
        </p>
        <pre aria-label="Redacted crash diagnostics">{report}</pre>
        <div className="fatal-actions">
          <button
            className="button button-primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void copy()}
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy diagnostics"}
          </button>
        </div>
        <a href="https://github.com/octos-org/octoscode-web/issues/new">
          Report this crash ↗
        </a>
      </section>
    </main>
  );
}

export function buildSafeDiagnostic(
  error: unknown,
  componentStack = "",
): string {
  const source =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : `Unknown render error: ${String(error)}`;
  return redactSecrets(`${source}\n${componentStack}`.trim()).slice(0, 4_000);
}

function redactSecrets(value: string): string {
  return value
    .replace(/([?&]token=)[^&\s)]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[^\s)]+/gi, "Bearer [redacted]");
}
