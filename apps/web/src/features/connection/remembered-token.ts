/** Remove credentials saved by the former device-memory feature. */
export function clearRememberedTokens(): boolean {
  try {
    const storage = window.localStorage;
    let cleared = true;
    for (const key of Object.keys(storage)) {
      if (!key.startsWith("octoscode-web.remembered-token.v1:")) continue;
      storage.removeItem(key);
      if (storage.getItem(key) !== null) cleared = false;
    }
    return cleared;
  } catch {
    return false;
  }
}
