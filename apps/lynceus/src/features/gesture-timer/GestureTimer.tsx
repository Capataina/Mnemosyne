import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GestureTimerConfigPanel } from "./GestureTimerConfigPanel";
import { GestureTimerSetup } from "./GestureTimerSetup";
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
  autoStart = null,
  className,
  disabled = false,
  onOpenChange,
}: GestureTimerProps) {
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const previousCandidateCountRef = useRef(candidateImages.length);
  const appliedAutoStartRef = useRef<GestureTimerConfig | null>(null);
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

  const restoreStartFocus = useCallback(() => {
    window.queueMicrotask(() => startButtonRef.current?.focus());
  }, []);

  const openRunningConfig = useCallback(() => {
    setDraftConfig(config);
    setConfigOpen(true);
  }, [config]);

  const dismissConfig = useCallback(() => {
    setConfigOpen(false);
    if (!running) {
      onOpenChange?.(false);
      restoreStartFocus();
    }
  }, [onOpenChange, restoreStartFocus, running]);

  const startTimer = useCallback(() => {
    const nextConfig = normaliseGestureTimerConfig(
      draftConfig,
      candidateImages.length,
    );
    setConfig(nextConfig);
    setDraftConfig(nextConfig);
    setConfigOpen(false);
    setRunning(true);
    setSessionKey((key) => key + 1);
    onOpenChange?.(true);
  }, [candidateImages.length, draftConfig, onOpenChange]);

  const confirmConfig = useCallback(() => {
    const nextConfig = normaliseGestureTimerConfig(
      draftConfig,
      candidateImages.length,
    );
    setConfig(nextConfig);
    setDraftConfig(nextConfig);
    setConfigOpen(false);
    setSessionKey((key) => key + 1);
  }, [candidateImages.length, draftConfig]);

  // Quick-start from the selected-hero pill: adopt the handed config and go
  // straight to the running view. Keyed on object identity so one config
  // starts one session; the pill can't fire while a session is already open
  // (the hero isn't hoverable behind the fullscreen inspector), but the
  // `running || configOpen` guard makes that impossible by construction too.
  useEffect(() => {
    if (!autoStart || appliedAutoStartRef.current === autoStart) return;
    if (running || configOpen || candidateImages.length === 0) return;
    appliedAutoStartRef.current = autoStart;
    const nextConfig = normaliseGestureTimerConfig(
      autoStart,
      candidateImages.length,
    );
    setConfig(nextConfig);
    setDraftConfig(nextConfig);
    setRunning(true);
    setSessionKey((key) => key + 1);
    onOpenChange?.(true);
  }, [autoStart, candidateImages.length, configOpen, onOpenChange, running]);

  const exitTimer = useCallback(() => {
    setConfigOpen(false);
    setRunning(false);
    onOpenChange?.(false);
    restoreStartFocus();
  }, [onOpenChange, restoreStartFocus]);

  const restartTimer = useCallback(() => {
    setSessionKey((key) => key + 1);
  }, []);

  const setupDisabled = disabled || candidateImages.length === 0;

  return (
    <>
      <GestureTimerSetup
        config={draftConfig}
        candidateCount={candidateImages.length}
        disabled={setupDisabled}
        startButtonRef={startButtonRef}
        className={className}
        onChange={updateDraft}
        onStart={startTimer}
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
