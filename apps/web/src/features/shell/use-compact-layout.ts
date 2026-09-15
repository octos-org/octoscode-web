import { useEffect, useState } from "react";

const QUERY = "(max-width: 760px)";

export function useCompactLayout() {
  const [compact, setCompact] = useState(
    () => window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(QUERY);
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}
