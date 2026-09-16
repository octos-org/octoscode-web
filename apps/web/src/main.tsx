import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { FatalErrorBoundary } from "./features/error/FatalErrorBoundary.tsx";
import { PreferencesProvider } from "./features/preferences/preferences.tsx";
import { consumePairingLink } from "./features/connection/pairing.ts";
import "./app/theme.css";
import "./app/styles.css";

// WEB-PAIRING-CONTRACT-5100 §Client step 3: read `octos`/`pair` and rewrite the
// address HERE — before the first render — so neither value can reach a
// screenshot, a referrer, or a devtools screenshot of the mounted app.
consumePairingLink();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount point");

createRoot(root).render(
  <StrictMode>
    <FatalErrorBoundary>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </FatalErrorBoundary>
  </StrictMode>,
);
