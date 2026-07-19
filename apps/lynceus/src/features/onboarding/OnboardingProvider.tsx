import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CURRENT_ONBOARDING_VERSION,
  useUserPreferences,
} from "../../hooks/useUserPreferences";
import { sceneRegistry } from "./sceneRegistry";
import { OnboardingOverlay } from "./OnboardingOverlay";

type OpenMode = "auto" | "replay" | null;

interface OnboardingContextValue {
  open: boolean;
  sceneIndex: number;
  sceneCount: number;
  back: () => void;
  next: () => void;
  skip: () => void;
  restart: (trigger?: HTMLElement | null) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  const value = useContext(OnboardingContext);
  if (!value) {
    throw new Error("useOnboarding must be used inside OnboardingProvider");
  }
  return value;
}

function focusReplayReturn(trigger: HTMLElement | null) {
  if (trigger?.isConnected) {
    trigger.focus();
    return;
  }
  document.querySelector<HTMLElement>('[aria-label="Settings"]')?.focus();
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { prefs, update } = useUserPreferences();
  const [bootGone, setBootGone] = useState(false);
  const [openMode, setOpenMode] = useState<OpenMode>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const appContentRef = useRef<HTMLDivElement>(null);
  const replayTriggerRef = useRef<HTMLElement | null>(null);
  const autoOpenedRef = useRef(false);
  const open = openMode !== null;

  // The brief forbids editing BootSplash, so the handshake observes its
  // existing accessible status node and arms onboarding only after that node
  // has actually unmounted. This preserves the plan's "not behind splash"
  // invariant without duplicating its timers or query semantics.
  useEffect(() => {
    const bootStillMounted = () =>
      document.querySelector('[role="status"][aria-label="Loading Lynceus"]');
    if (!bootStillMounted()) {
      setBootGone(true);
      return;
    }
    const observer = new MutationObserver(() => {
      if (!bootStillMounted()) {
        setBootGone(true);
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (
      bootGone &&
      !autoOpenedRef.current &&
      prefs.onboardingVersionSeen < CURRENT_ONBOARDING_VERSION
    ) {
      autoOpenedRef.current = true;
      setSceneIndex(0);
      setOpenMode("auto");
    }
  }, [bootGone, prefs.onboardingVersionSeen]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const close = useCallback(
    (persist: boolean) => {
      const mode = openMode;
      if (persist && mode === "auto") {
        update("onboardingVersionSeen", CURRENT_ONBOARDING_VERSION);
      }
      setOpenMode(null);
      setSceneIndex(0);
      if (mode === "replay") {
        const trigger = replayTriggerRef.current;
        requestAnimationFrame(() => focusReplayReturn(trigger));
      }
    },
    [openMode, update],
  );

  const back = useCallback(() => {
    setSceneIndex((current) => Math.max(0, current - 1));
  }, []);

  const next = useCallback(() => {
    if (sceneIndex >= sceneRegistry.length - 1) {
      close(true);
      return;
    }
    setSceneIndex((current) => Math.min(sceneRegistry.length - 1, current + 1));
  }, [close, sceneIndex]);

  const skip = useCallback(() => close(true), [close]);

  const restart = useCallback((trigger?: HTMLElement | null) => {
    replayTriggerRef.current = trigger ?? null;
    setSceneIndex(0);
    setOpenMode("replay");
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      open,
      sceneIndex,
      sceneCount: sceneRegistry.length,
      back,
      next,
      skip,
      restart,
    }),
    [back, next, open, restart, sceneIndex, skip],
  );

  return (
    <OnboardingContext.Provider value={value}>
      <div
        ref={appContentRef}
        data-onboarding-app-content
        inert={open ? true : undefined}
        aria-hidden={open ? true : undefined}
      >
        {children}
      </div>
      {open && <OnboardingOverlay />}
    </OnboardingContext.Provider>
  );
}
