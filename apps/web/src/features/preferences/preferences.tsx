import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { bindPreferencesDocument, DisplayPreferencesStore } from "./model.ts";
import { UiTextProvider } from "./ui-text.tsx";

const PreferencesContext = createContext<DisplayPreferencesStore | null>(null);
const fallbackStore = new DisplayPreferencesStore();
const ignoreChange = () => {};
const cannotSave = () => false;

function createBrowserStore() {
  let storage: Storage | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage access may be disabled independently of the rest of the browser.
  }
  return new DisplayPreferencesStore(
    storage,
    typeof navigator === "undefined" ? "en" : navigator.language,
  );
}

/** Mount once above App. Display changes never key or replace the Session tree. */
export function PreferencesProvider({
  children,
  store,
}: {
  children: ReactNode;
  store?: DisplayPreferencesStore;
}) {
  const [ownedStore] = useState(() => store ?? createBrowserStore());
  const snapshot = useSyncExternalStore(
    ownedStore.subscribe,
    ownedStore.getSnapshot,
    ownedStore.getSnapshot,
  );
  useEffect(() => {
    if (typeof document !== "undefined")
      return bindPreferencesDocument(ownedStore, document.documentElement);
  }, [ownedStore]);
  return (
    <PreferencesContext.Provider value={ownedStore}>
      <UiTextProvider language={snapshot.language}>{children}</UiTextProvider>
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const providedStore = useContext(PreferencesContext);
  const store = providedStore ?? fallbackStore;
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return useMemo(
    () => ({
      ...snapshot,
      setTheme: providedStore?.setTheme ?? ignoreChange,
      setLanguage: providedStore?.setLanguage ?? ignoreChange,
      setVimMode: providedStore?.setVimMode ?? ignoreChange,
      save: providedStore?.save ?? cannotSave,
    }),
    [providedStore, snapshot],
  );
}
