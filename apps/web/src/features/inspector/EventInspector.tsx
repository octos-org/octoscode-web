import type { RpcNotification } from "@octos-org/octoscode-client";

export interface ObservedEvent {
  id: number;
  at: string;
  notification: RpcNotification;
}

interface EventInspectorProps {
  events: readonly ObservedEvent[];
  features: readonly string[];
  embedded?: boolean;
}

export function EventInspector({
  events,
  features,
  embedded = false,
}: EventInspectorProps) {
  const content = (
    <>
      <section>
        <div className="section-heading compact-heading">
          <div>
            <span className="eyebrow">Negotiated</span>
            <h2>Capabilities</h2>
          </div>
          <span className="count-badge">{features.length}</span>
        </div>
        <div className="feature-list">
          {features.length === 0 ? (
            <p className="muted">
              Connect to inspect accepted server features.
            </p>
          ) : (
            features.map((feature) => <span key={feature}>{feature}</span>)
          )}
        </div>
      </section>

      <section className="event-section">
        <div className="section-heading compact-heading">
          <div>
            <span className="eyebrow">Wire</span>
            <h2>Event stream</h2>
          </div>
          <span className="count-badge">{events.length}</span>
        </div>
        <div className="event-list">
          {events.length === 0 ? (
            <p className="muted">No protocol events received.</p>
          ) : (
            [...events].reverse().map((event) => (
              <details className="event-row" key={event.id}>
                <summary>
                  <span>{event.notification.method}</span>
                  <time>{event.at}</time>
                </summary>
                <pre>{safeJson(event.notification.params)}</pre>
              </details>
            ))
          )}
        </div>
      </section>
    </>
  );
  return embedded ? (
    <div className="embedded-inspector">{content}</div>
  ) : (
    <aside className="inspector">{content}</aside>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
