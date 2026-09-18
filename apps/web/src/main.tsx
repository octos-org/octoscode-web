import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionGate } from "./app/ConnectionGate.tsx";
import { FatalErrorBoundary } from "./features/error/FatalErrorBoundary.tsx";
import { PreferencesProvider } from "./features/preferences/preferences.tsx";
import { consumePairingLink } from "./features/connection/pairing.ts";
import "./app/theme.css";
import "./app/styles.css";

// WEB-PAIRING-CONTRACT-5100 §Client step 3: read `octos`/`pair` and rewrite the
// address before the first render. The HTML referrer policy also protects
// the resource requests made before this module runs.
consumePairingLink();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount point");

createRoot(root).render(
  <StrictMode>
    <FatalErrorBoundary>
      <PreferencesProvider>
        <ConnectionGate />
      </PreferencesProvider>
    </FatalErrorBoundary>
  </StrictMode>,
);
