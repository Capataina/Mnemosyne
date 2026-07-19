import { useSyncExternalStore } from "react";

/**
 * User-facing UI preferences that don't need to round-trip through
 * the Rust backend. Stored in localStorage so they survive across
 * app launches; backed by a shared module store so every component
 * re-renders the instant one changes.
 *
 * The schema is deliberately kept loose with serde-friendly defaults
 * — when we add a new field in a future version, older saved JSON
 * just deserialises with the missing field set to its default.
 */

export type ThemeMode = "system" | "dark" | "light";
export type AnimationLevel = "off" | "subtle" | "standard";
export type TagFilterMode = "any" | "all";

export interface UserPreferences {
  /** "system" follows the OS, others force. Default "system". */
  theme: ThemeMode;
  /**
   * Column count for the masonry grid. 0 = "auto" (compute from
   * container width / minItemWidth). Otherwise 1..8.
   */
  columnCount: number;
  /** Min tile width in pixels when columnCount is auto. */
  tileMinWidth: number;
  /** Tile aspect-preserving size scale, multiplier of the base. */
  tileScale: number;
  /** Animation magnitude. */
  animationLevel: AnimationLevel;
  /** Number of results returned for "More like this". */
  similarResultCount: number;
  /** Number of results returned for semantic search. */
  semanticResultCount: number;
  /** Whether multi-tag filter ANDs (all) or ORs (any). */
  tagFilterMode: TagFilterMode;
  /** Most recent onboarding revision completed or skipped by the user. */
  onboardingVersionSeen: number;
  /**
   * LEGACY (deprecated 2026-04-26 with Phase 11c).
   *
   * Was the user's primary image encoder back when the picker was a
   * single-choice dropdown. Phase 5 RRF + Phase 11c per-encoder
   * toggles obsolete the priority concept: fusion uses every enabled
   * encoder. Field kept on the type so existing localStorage
   * deserialises without erroring; the value is ignored — the
   * Settings drawer reads `enabled_encoders` from the backend
   * (settings.json) instead.
   */
  imageEncoder: string;
  /** LEGACY — same shape as `imageEncoder`, ignored. */
  textEncoder: string;
}

const DEFAULTS: UserPreferences = {
  theme: "system",
  columnCount: 0,
  tileMinWidth: 236,
  tileScale: 1.0,
  animationLevel: "standard",
  similarResultCount: 35,
  semanticResultCount: 50,
  tagFilterMode: "any",
  onboardingVersionSeen: 0,
  imageEncoder: "dinov2_base",
  textEncoder: "clip_vit_b_32",
};

export const CURRENT_ONBOARDING_VERSION = 1;

const STORAGE_KEY = "imageBrowserPrefs";
const THEME_KEY = "theme";

function loadFromStorage(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    // Merge with defaults so newly-added fields land at their defaults
    // rather than undefined.
    const merged = { ...DEFAULTS, ...parsed };
    // Migrate legacy encoder IDs that no longer exist in the backend.
    // Pre pipeline-version-2 saved `dinov2_small` (384-d Small) — that
    // ID was wiped by the migration and the active encoder is
    // `dinov2_base` (768-d). Without this remap, returning users keep
    // dispatching against an empty cosine cache.
    if (merged.imageEncoder === "dinov2_small") {
      merged.imageEncoder = "dinov2_base";
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveToStorage(prefs: UserPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    // Theme is mirrored to its own key so main.tsx can read it before
    // React mounts (avoids the FOUC of wrong-theme flash).
    localStorage.setItem(THEME_KEY, prefs.theme);
  } catch {
    // localStorage may be disabled in some WebView modes; the in-memory
    // state still works, just doesn't persist.
  }
}

/**
 * Apply the theme preference to <html>. Called whenever the theme
 * setting changes; the initial application happens in main.tsx
 * before React mounts (which avoids a flash of wrong colours).
 */
function applyThemeToDom(theme: ThemeMode) {
  const root = document.documentElement;
  let dark: boolean;
  switch (theme) {
    case "dark":
      dark = true;
      break;
    case "light":
      dark = false;
      break;
    case "system":
    default:
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      break;
  }
  if (dark) root.classList.add("dark");
  else root.classList.remove("dark");
}

/* ---------------------------------------------------------------------------
 * Module singleton: one shared preferences store for the whole app.
 *
 * Preferences used to be a per-component `useState(loadFromStorage)`, so every
 * caller of `useUserPreferences()` held its OWN independent copy. The settings
 * drawer's `update()` wrote localStorage and re-rendered the drawer, but the
 * route (and every other consumer) kept its stale copy until a fresh launch
 * re-ran `loadFromStorage` — which is exactly why every control "only took
 * effect after restarting the app". Now a single module-level object backs
 * every consumer through `useSyncExternalStore`: one `update()` notifies all
 * subscribers, so the grid re-renders the instant a control changes. Mirrors
 * the singleton-store pattern already used in useIndexingStatus.ts.
 * ------------------------------------------------------------------------- */

let store: UserPreferences = loadFromStorage();
const subscribers = new Set<() => void>();
let watchersStarted = false;

function notify() {
  for (const cb of subscribers) cb();
}

/**
 * Re-read localStorage into the store. Runs when the store (re)connects to the
 * UI (first subscriber) and on cross-window `storage` events, so an external
 * change to the saved prefs is reflected without a reload — the equivalent of
 * the old per-mount `loadFromStorage`. In-app `update`/`resetAll` always write
 * localStorage before notifying, so localStorage is never staler than the
 * store and a rehydrate can't clobber a fresher value.
 */
function hydrateFromStorage() {
  store = loadFromStorage();
}

/**
 * Register the app-lifetime theme watchers exactly once (mirrors the
 * listener-started pattern in useIndexingStatus.ts). The OS colour-scheme
 * listener re-applies the theme on system dark/light flips, but only while the
 * preference is "system"; the storage listener keeps other windows in sync.
 * Both are kept for the app lifetime — no teardown, since the prefs consumers
 * in the shell are effectively always mounted.
 */
function ensureWatchers() {
  if (watchersStarted) return;
  watchersStarted = true;

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    if (store.theme === "system") applyThemeToDom("system");
  });

  window.addEventListener("storage", (event) => {
    // Only react to our own keys (null key = storage.clear()).
    if (event.key !== null && event.key !== STORAGE_KEY && event.key !== THEME_KEY) {
      return;
    }
    hydrateFromStorage();
    applyThemeToDom(store.theme);
    notify();
  });
}

/** Stable subscribe fn for `useSyncExternalStore`. On the first subscriber the
 *  store (re)connects to the UI: sync from localStorage and apply the current
 *  theme, matching the old per-mount `loadFromStorage` + theme effect. */
function subscribe(cb: () => void): () => void {
  const firstSubscriber = subscribers.size === 0;
  subscribers.add(cb);
  ensureWatchers();
  if (firstSubscriber) {
    hydrateFromStorage();
    applyThemeToDom(store.theme);
  }
  return () => {
    subscribers.delete(cb);
  };
}

const getSnapshot = () => store;

/**
 * Update one preference: replace the shared store with a new object (so React's
 * Object.is check re-renders), persist, apply the theme side effect when the
 * theme changed, and notify every subscriber so all consumers re-render at once.
 */
function updatePreference<K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K],
) {
  store = { ...store, [key]: value };
  saveToStorage(store);
  if (key === "theme") applyThemeToDom(store.theme);
  notify();
}

/**
 * Reset every UI preference while preserving onboarding completion. Replay is
 * an explicit Settings action, so a preference reset must not schedule the
 * walkthrough for the next launch.
 */
function resetAllPreferences() {
  store = {
    ...DEFAULTS,
    onboardingVersionSeen: store.onboardingVersionSeen,
  };
  saveToStorage(store);
  applyThemeToDom(store.theme);
  notify();
}

/**
 * React hook for the shared preferences store. Every consumer reads the same
 * underlying object, so an `update()` from any one of them (e.g. the settings
 * drawer) re-renders all of them immediately — no app restart required.
 *
 * Theme application is a side effect of `update("theme", …)` and of the store
 * (re)connecting; changing the theme flips the `.dark` class on <html>, which
 * Tailwind's dark variants pick up with no component re-render needed. When the
 * theme is "system", an OS-level colour-scheme change re-applies it.
 */
export function useUserPreferences() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot);
  return { prefs, update: updatePreference, resetAll: resetAllPreferences };
}

export const PREF_DEFAULTS = DEFAULTS;
