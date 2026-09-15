import { useEffect } from "react";
import type { AttentionSettings } from "./desktop-notifications.ts";
import { useAttention, type AttentionInput } from "./use-attention.ts";

interface AttentionBridgeProps extends AttentionInput {
  onSettingsChange: (settings: AttentionSettings | null) => void;
}

/** Loaded after authentication; no notification code is needed at the gate. */
export function AttentionBridge({
  onSettingsChange,
  ...input
}: AttentionBridgeProps) {
  const { settings } = useAttention(input);
  useEffect(() => {
    onSettingsChange(settings);
  }, [onSettingsChange, settings]);
  useEffect(() => () => onSettingsChange(null), [onSettingsChange]);
  return null;
}
