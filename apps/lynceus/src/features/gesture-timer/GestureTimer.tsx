import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GestureTimerConfigPanel } from "./GestureTimerConfigPanel";
import { GestureTimerTrigger } from "./GestureTimerTrigger";
import { GestureTimerView } from "./GestureTimerView";
import {
  mergeGestureTimerConfig,
  normaliseGestureTimerConfig,
} from "./session";
import type {
  GestureTimerConfig,
  GestureTimerProps,
} from "./types";
import "./gesture-timer.css";

export function GestureTimer({
  startingImage,
  candidateImages,
  initialConfig,
  className,
  disabled = false,
  onOpenChange,
}: GestureTimerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousCandidateCountRef = useRef(candidateImages.length);
  const initial = useMemo(
    () => mergeGestureTimerConfig(initialConfig, candidateImages.length),
    [candidateImages.length, initialConfig],
  );
  const [config, setConfig] = useState<GestureTimerConfig>(initial);
  const [draftConfig, setDraftConfig] = useState<GestureTimerConfig>(initial);
  const [configOpen, setConfigOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const overlayOpen = configOpen || running;

  useEffect(() => {
    if (!overlayOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [overlayOpen]);

  useEffect(() => {
    if (previousCandidateCountRef.current === candidateImages.length) return;
    previousCandidateCountRef.current = candidateImages.length;
    if (running || configOpen) return;

    const nextConfig = mergeGestureTimerConfig(
      initialConfig,
      candidateImages.length,
    );
    setConfig(nextConfig);
    setDraftConfig(nextConfig);
  }, [candidateImages.length, configOpen, initialConfig, running]);

  const updateDraft = useCallback(
    (nextConfig: GestureTimerConfig) => {
      setDraftConfig(nextConfig);
    },
    [],
  );

  const restoreTriggerFocus = useCallback(() => {
    window.queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  const openInitialConfig = useCallback(() => {
    const nextConfig = normaliseGestureTimerConfig(
      config,
      candidateImages.length,
    );
    setDraftConfig(nextConfig);
    setConfigOpen(true);
    onOpenChange?.(true);
  }, [candidateImages.length, config, onOpenChange]);

  const openRunningConfig = useCallback(() => {
    setDraftConfig(config);
    setConfigOpen(true);
  }, [config]);

  const dismissConfig = useCallback(() => {
    setConfigOpen(false);
    if (!running) {
      onOpenChange?.(false);
      restoreTriggerFocus();
    }
  }, [onOpenChange, restoreTriggerFocus, running]);

  const confirmConfig = useCallback(() => {
    const nextConfig = normaliseGestureTimerConfig(
      draftConfig,
      candidateImages.length,
    );
    setConfig(nextConfig);
    setDraftConfig(nextConfig);
    setConfigOpen(false);
    setRunning(true);
    setSessionKey((key) => key + 1);
  }, [candidateImages.length, draftConfig]);

  const exitTimer = useCallback(() => {
    setConfigOpen(false);
    setRunning(false);
    onOpenChange?.(false);
    restoreTriggerFocus();
  }, [onOpenChange, restoreTriggerFocus]);

  const restartTimer = useCallback(() => {
    setSessionKey((key) => key + 1);
  }, []);

  const triggerDisabled = disabled || candidateImages.length === 0;
  const defaultPlacement =
    "absolute bottom-4 left-4 z-20 shadow-[0_14px_38px_-22px_var(--shadow-color)] max-[760px]:bottom-3 max-[760px]:left-3";

  return (
    <>
      <GestureTimerTrigger
        ref={triggerRef}
        className={className ?? defaultPlacement}
        disabled={triggerDisabled}
        onClick={openInitialConfig}
        title={
          triggerDisabled
            ? "Load similar images before starting a timer"
            : undefined
        }
      />

      {typeof document !== "undefined" &&
        createPortal(
          <>
            {running && (
              <GestureTimerView
                key={sessionKey}
                startingImage={startingImage}
                candidateImages={candidateImages}
                config={config}
                settingsOpen={configOpen}
                onRequestSettings={openRunningConfig}
                onRestart={restartTimer}
                onExit={exitTimer}
              />
            )}
            {configOpen && (
              <GestureTimerConfigPanel
                config={draftConfig}
                candidateCount={candidateImages.length}
                mode={running ? "restart" : "start"}
                onChange={updateDraft}
                onConfirm={confirmConfig}
                onDismiss={dismissConfig}
              />
            )}
          </>,
          document.body,
        )}
    </>
  );
}
