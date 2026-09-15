import { useLayoutEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

type ThemeBrowser = Pick<Window, "localStorage">;
const STORAGE_KEY = "dsw-theme";

export function readThemePreference(
  browser: ThemeBrowser = window,
): ThemePreference {
  try {
    const saved = browser.localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function saveThemePreference(
  theme: ThemePreference,
  browser: ThemeBrowser = window,
): void {
  try {
    if (theme === "system") browser.localStorage.removeItem(STORAGE_KEY);
    else browser.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Saving a visual preference is optional. The in-memory choice remains
    // active when storage is blocked or full.
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(readThemePreference);

  useLayoutEffect(() => {
    // Apply before React's first paint and before storage, which can fail.
    // With no override, CSS color-scheme responds to OS changes natively.
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    saveThemePreference(theme);
  }, [theme]);

  const cycleTheme = () => {
    setTheme((current) =>
      current === "system" ? "dark" : current === "dark" ? "light" : "system",
    );
  };

  return { theme, cycleTheme };
}
