import type { RpcNotification } from "@octos-org/octoscode-client/protocol";
import { useUiText } from "../preferences/ui-text.tsx";

export interface ObservedEvent {
  id: number;
  at: string;
  notification: RpcNotification;
}

interface EventInspectorProps {
  events: readonly ObservedEvent[];
  features: readonly string[];
  omittedEvents?: number;
  embedded?: boolean;
}

export function EventInspector({
  events,
  features,
  omittedEvents = 0,
  embedded = false,
}: EventInspectorProps) {
  const t = useUiText();
  const content = (
    <>
      <section>
        <div className="section-heading compact-heading">
          <div>
            <span className="eyebrow">{t("Negotiated")}</span>
            <h2>{t("Capabilities")}</h2>
          </div>
          <span className="count-badge">{features.length}</span>
        </div>
        <div className="feature-list">
          {features.length === 0 ? (
            <p className="muted">
              {t("Connect to inspect accepted server features.")}
            </p>
          ) : (
            features.map((feature) => <span key={feature}>{feature}</span>)
          )}
        </div>
      </section>

      <section className="event-section">
        <div className="section-heading compact-heading">
          <div>
            <span className="eyebrow">{t("Wire")}</span>
            <h2>{t("Event stream")}</h2>
          </div>
          <span className="count-badge">{events.length}</span>
        </div>
        <div className="event-list">
          {omittedEvents ? (
            <p className="muted" role="status">
              {omittedEvents}
              {" " + t("older protocol event")}
              {omittedEvents === 1 ? " " + t("is") : t("s are")}
              {" " + t("outside this diagnostic window.")}
            </p>
          ) : null}
          {events.length === 0 ? (
            <p className="muted">{t("No protocol events received.")}</p>
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
