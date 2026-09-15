import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { FatalErrorBoundary } from "./features/error/FatalErrorBoundary.tsx";
import { PreferencesProvider } from "./features/preferences/preferences.tsx";
import "./app/theme.css";
import "./app/styles.css";

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
