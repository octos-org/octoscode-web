import type { ComponentProps } from "react";
import { ActivityNavigator } from "./ActivityNavigator.tsx";
import { useActivityCatalog } from "./use-activity-catalog.ts";

type Props = Omit<ComponentProps<typeof ActivityNavigator>, "state"> & {
  catalog: Parameters<typeof useActivityCatalog>[0];
};

/** Load cross-session scanning only when the operator opens Activity. */
export function ActivityDialog({ catalog, ...props }: Props) {
  const state = useActivityCatalog(catalog);
  return <ActivityNavigator {...props} state={state} />;
}
