import { useCallback, useEffect, useRef, useState, useMemo, Profiler } from "react";
import Masonry from "../components/Masonry";
import type { MasonryPlacementAnchor } from "../components/masonryPacking";
import {
  useFeedManifest,
  useImageDetail,
  prefetchImageDetails,
  useAssignTagToImage,
  useRemoveTagFromImage,
  useSetManualColSpan,
} from "../queries/useImages";
import { useTieredSimilarImages } from "../queries/useSimilarImages";
import { useSemanticSearch } from "../queries/useSemanticSearch";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useShuffledFeed, newShuffleSeed } from "../hooks/useShuffledFeed";
import { usePipelineStats, useIsIndexing } from "../hooks/useIndexingStatus";
import { LibraryDrawer, useBubbleTrigger } from "@/components/library-drawer";
import { useConfirm } from "@/components/ui/confirm";
import { getTagCounts } from "@/services/tags";
import { FeedItem, ImageItem, Tag } from "../types";
import { AnimatePresence } from "framer-motion";
import { useLocation, useNavigate } from "react-router";
import { useTags, useCreateTag, useDeleteTag } from "@/queries/useTags";
import { TopBar } from "./TopBar";
import { EmptyState } from "./EmptyState";
import { SimilarHeader } from "./SimilarHeader";
import { SemanticStatus } from "./SemanticStatus";
import { PinterestModal } from "@/components/PinterestModal";
import { IndexingStatusPill } from "@/components/IndexingStatusPill";
import { SettingsDrawer } from "@/components/settings";
import { PerfOverlay } from "@/components/PerfOverlay";
import { isProfilingEnabled, recordAction, onRenderProfiler } from "@/services/perf";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pickScanFolder, fetchFusedSimilarImages } from "@/services/images";
import { useAddRoot, useRoots } from "@/queries/useRoots";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { getImageNotes, setImageNotes } from "@/services/notes";
import { SelectedImageTimerPill } from "@/components/SelectedImageTimerPill";
import type { GestureTimerConfig } from "@/features/gesture-timer/types";

/**
 * Synchronous selection seed built from a grid entry (T3-1). The compact
 * manifest has no tags and no full-res URL, so a fresh click selects this
 * interim shape immediately (keeping the feed→similar swap instant) and
 * the URL effect upgrades it to the hydrated `ImageItem` the moment the
 * per-id detail query lands — usually the same tick, thanks to the
 * click/hover prefetch.
 */
function seedSelectionItem(entry: FeedItem): ImageItem {
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url ?? entry.thumbnailUrl ?? "",
    thumbnailUrl: entry.thumbnailUrl,
    hasThumbnail: entry.hasThumbnail,
    width: entry.width,
    height: entry.height,
    tags: [],
    manualColSpan: entry.manualColSpan ?? null,
  };
}

export default function Home() {
  const [selectedItem, setSelectedItem] = useState<ImageItem | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  // Timer config handed from the hero quick-start pill to the inspector's
  // GestureTimer (which auto-starts on it). Null = normal inspect open.
  const [pendingTimerStart, setPendingTimerStart] =
    useState<GestureTimerConfig | null>(null);
  const [searchTags, setSearchTags] = useState<Tag[]>([]);
  const [searchText, setSearchText] = useState("");
  // Settings bubble: hover-open-with-intent + click-to-pin state machine
  // (useBubbleTrigger, shared with the library bubble below). Mutual
  // exclusion between the two lives in the effect pair further down.
  const settings = useBubbleTrigger();
  // Profiling state — flipped to true once at mount if the binary was
  // launched with `--profiling`. Drives three things: whether the perf
  // overlay mounts at all, whether cmd+shift+P does anything, and
  // (later) whether action breadcrumbs get emitted to the backend.
  // Without `--profiling`, every profiling-related code path stays cold.
  const [profiling, setProfiling] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const { prefs } = useUserPreferences();
  const { data: roots } = useRoots();
  const addRootMutation = useAddRoot();

  // Resolve the profiling flag once at mount. When set, auto-open the
  // overlay so the user doesn't have to discover the cmd+shift+P
  // shortcut — if you started the app with --profiling, you wanted to
  // see the diagnostics.
  useEffect(() => {
    isProfilingEnabled().then((on) => {
      setProfiling(on);
      if (on) setPerfOpen(true);
    });
  }, []);

  // Global keyboard shortcuts:
  //   ⌘,        — toggle settings drawer (always available)
  //   ⌘⇧P       — toggle performance overlay (profiling mode only)
  // The shortcuts use ⌘ on macOS and Ctrl elsewhere, both are standard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmdOrCtrl = e.metaKey || e.ctrlKey;
      if (cmdOrCtrl && e.key === ",") {
        e.preventDefault();
        recordAction(settings.pinned ? "settings_close" : "settings_open", {
          via: "shortcut",
        });
        settings.togglePinned();
        return;
      }
      if (
        profiling &&
        cmdOrCtrl &&
        e.shiftKey &&
        (e.key === "P" || e.key === "p")
      ) {
        e.preventDefault();
        setPerfOpen((s) => !s);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profiling, settings.pinned, settings.togglePinned]);

  // Debounce search text for semantic search (300ms delay)
  const debouncedSearchText = useDebouncedValue(searchText, 300);

  // Determine if we should use semantic search:
  // - Has search text that doesn't start with # (tag selector)
  // - No selected item (not viewing similar images)
  const semanticQuery = debouncedSearchText.trim();
  const shouldUseSemanticSearch =
    semanticQuery.length > 0 && !semanticQuery.startsWith("#") && !selectedItem;

  // The feed re-shuffles on each "entry": launch (a random initial seed)
  // and returning to the feed from a search / similar view (the effect
  // below). Indexing-progress refetches keep the SAME seed, so existing
  // tiles hold their positions and only newly-thumbnailed images pop in.
  const [shuffleSeed, setShuffleSeed] = useState<number>(() =>
    newShuffleSeed(),
  );
  // In-session drag-reorder: a full id ordering applied on top of the
  // shuffle, NOT persisted — a reshuffle (new entry) clears it.
  const [sessionOrder, setSessionOrder] = useState<number[] | null>(null);
  // Session rectangle pins for gesture-placed tiles: a dropped or resized
  // tile keeps the exact committed telegraph coordinate while occupancy
  // backfills around it. Shares the session order's lifecycle exactly.
  const [placementAnchors, setPlacementAnchors] = useState<
    Record<number, MasonryPlacementAnchor>
  >({});
  // Similarity navigation trail: the images dived through via
  // similar→click→similar. Powers back-one-hop + a breadcrumb strip so a
  // deep cascade stays navigable (the UX council's top pick). Cleared on
  // return to the feed.
  const [simTrail, setSimTrail] = useState<ImageItem[]>([]);
  // Library bubble (folders-as-tags): hover/pin state machine + the
  // exclude-tag ("must not have") filter set. The include set is
  // `searchTags`, shared with the search bar; the open-folder highlight is
  // DERIVED from it below.
  const library = useBubbleTrigger();
  const [excludeTags, setExcludeTags] = useState<Tag[]>([]);
  const confirm = useConfirm();

  // Mutual exclusion: the two bubbles never show at once — a hover-peek or
  // a pin on one closes the other outright (pin AND hover), matching the
  // founder spec's "opening one closes the other". Guarded on the target's
  // own `open` so this can't oscillate: closing an already-closed bubble
  // is a no-op and doesn't re-trigger the other's effect.
  useEffect(() => {
    if (library.open) settings.close();
  }, [library.open, settings.close]);
  useEffect(() => {
    if (settings.open) library.close();
  }, [settings.open, library.close]);

  // T3-1: the compact layout manifest replaces the full catalogue fetch.
  // Same membership, same filter surface; tags/notes/full paths are
  // hydrated per id (useImageDetail) only where a surface needs them.
  const manifest = useFeedManifest({
    tagIds: searchTags.map((t) => t.id),
    matchAllTags: prefs.tagFilterMode === "all",
    excludeTagIds: excludeTags.map((t) => t.id),
  });

  // The main feed: stable-key shuffle + thumbnail-gate + any in-session
  // reorder. Search / similar results bypass this and keep their ranking.
  const feed = useShuffledFeed(manifest.data, shuffleSeed, sessionOrder);
  // Narrow consumption: stats drive the drawer/count, `isIndexing` is a coarse
  // flag that flips on phase transitions only. Neither subscribes to the
  // per-event `message`, so an indexing run's message churn no longer
  // re-renders this route (and, via stable handlers, no longer the grid).
  const pipelineStats = usePipelineStats();
  const isIndexing = useIsIndexing();

  // "All images" count for the library drawer. NOT `manifest.data.length` —
  // that's the currently-filtered manifest, which shrinks to the selected
  // folder's size. total_images − orphaned is the whole non-orphaned
  // library: a stable superset of every tag-folder count (so "All images"
  // never reads smaller than a folder), independent of the active filter.
  // Falls back to the loaded manifest length until the first stats poll.
  const totalVisibleImages = pipelineStats
    ? Math.max(0, pipelineStats.total_images - pipelineStats.orphaned)
    : (manifest.data?.length ?? 0);

  // Re-shuffle whenever the user leaves a results view (search or
  // similar) back to the main feed. Launch is covered by the random
  // initial seed above.
  const isResultsView = !!selectedItem || shouldUseSemanticSearch;
  const prevResultsView = useRef(isResultsView);
  useEffect(() => {
    if (prevResultsView.current && !isResultsView) {
      setShuffleSeed(newShuffleSeed());
      setSessionOrder(null);
      setPlacementAnchors({});
    }
    prevResultsView.current = isResultsView;
  }, [isResultsView]);

  // Per-image notes (Phase 11). Lazy-loaded when the inspector opens.
  const [activeNotes, setActiveNotes] = useState<string>("");
  useEffect(() => {
    if (!selectedItem) {
      setActiveNotes("");
      return;
    }
    let cancelled = false;
    getImageNotes(selectedItem.id)
      .then((n) => {
        if (!cancelled) setActiveNotes(n);
      })
      .catch(() => {
        // Non-fatal — notes are optional. Treat as empty.
        if (!cancelled) setActiveNotes("");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedItem?.id]);

  // Semantic search query (only runs when shouldUseSemanticSearch is true)
  const semanticSearchResults = useSemanticSearch(
    shouldUseSemanticSearch ? semanticQuery : "",
    50
  );

  const tags = useTags();
  const createTagMutation = useCreateTag();
  const deleteTagMutation = useDeleteTag();
  const assignTagMutation = useAssignTagToImage();
  const removeTagMutation = useRemoveTagFromImage();
  const setManualColSpanMutation = useSetManualColSpan();
  // Pass the user's chosen image-image encoder so switching it in
  // Settings auto-refetches (the encoder_id is part of the query key).
  const tieredSimilarImages = useTieredSimilarImages(
    selectedItem?.id,
    prefs.imageEncoder,
  );

  // --- Library drawer wiring (folders-as-tags) -------------------------
  // Merge the tag list with per-tag image counts (visibility-matched on
  // the backend) so each folder shows how many images it contains.
  const tagCounts = useQuery({ queryKey: ["tagCounts"], queryFn: getTagCounts });
  const libraryTags = useMemo(() => {
    const counts = new Map(
      (tagCounts.data ?? []).map((c) => [c.tag_id, c.count] as const),
    );
    return (tags.data ?? []).map((t) => ({
      ...t,
      imageCount: counts.get(t.id) ?? 0,
    }));
  }, [tags.data, tagCounts.data]);
  const includeTagIds = useMemo(
    () => new Set(searchTags.map((t) => t.id)),
    [searchTags],
  );
  const excludeTagIdSet = useMemo(
    () => new Set(excludeTags.map((t) => t.id)),
    [excludeTags],
  );
  // The "active folder" highlight is DERIVED from the include set, not
  // separate state: a single included tag IS "viewing that folder". Deriving
  // it means removing that chip in the search bar also clears the drawer
  // highlight — there's no second copy of the state to fall out of sync.
  const activeFolderId = searchTags.length === 1 ? searchTags[0].id : null;

  // A library-drawer filter means "browse the feed by this filter". If a
  // competing view is up — an open similar-set (selectedItem) or an active
  // semantic search (searchText) — the filter refetches the feed but the
  // grid keeps showing the similar/semantic results, so the filter looks
  // like it did nothing until you exit and the feed lurches to it. Leave
  // that view first: clear the text (exits semantic) and, if an image is
  // open, navigate home (exits the similar-set). Then the filter is applied
  // to the visible feed, immediately and coherently.
  const exitToFeed = () => {
    setSearchText("");
    if (selectedItem) navigate("/");
  };

  // Select a tag-folder: filter the feed to that single tag (the derived
  // highlight follows). Passing null clears the folder selection.
  const handleSelectFolder = (tagId: number | null) => {
    const tag = tagId === null ? null : (tags.data ?? []).find((t) => t.id === tagId);
    setSearchTags(tag ? [tag] : []);
    // Keep include and exclude disjoint: selecting a folder that was in the
    // exclude set must drop it there, otherwise the same tag is required AND
    // forbidden and the grid is always empty under a highlighted folder.
    if (tag) setExcludeTags((prev) => prev.filter((t) => t.id !== tag.id));
    exitToFeed();
  };

  // Toggle a tag's filter: include ("must have", lives in searchTags,
  // shared with the search bar) / exclude ("must not have", excludeTags) /
  // off. The two sets stay disjoint.
  const handleSetTagFilter = (
    tagId: number,
    state: "include" | "exclude" | null,
  ) => {
    const tag = (tags.data ?? []).find((t) => t.id === tagId);
    if (!tag) return;
    setSearchTags((prev) =>
      state === "include"
        ? prev.some((t) => t.id === tagId)
          ? prev
          : [...prev, tag]
        : prev.filter((t) => t.id !== tagId),
    );
    setExcludeTags((prev) =>
      state === "exclude"
        ? prev.some((t) => t.id === tagId)
          ? prev
          : [...prev, tag]
        : prev.filter((t) => t.id !== tagId),
    );
    // Applying a filter (not un-toggling one) means "show me the feed with
    // this filter" — leave any competing similar/semantic view so it lands.
    if (state !== null) exitToFeed();
  };

  const handleClearFilters = () => {
    setSearchTags([]);
    setExcludeTags([]);
  };

  // Active search mode, for the search-bar indicator.
  const searchMode: "tags" | "semantic" | "idle" = shouldUseSemanticSearch
    ? "semantic"
    : searchTags.length > 0
      ? "tags"
      : "idle";

  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Hydrated detail for the image the URL points at (tags + full-res URL
  // for the inspector). Undefined path → query disabled. The selection
  // effect below seeds synchronously from the grid entry and upgrades to
  // this the moment it resolves.
  const urlImageId = (() => {
    const pathId = location.pathname.replace(/\//g, "");
    if (!pathId) return undefined;
    const n = Number(pathId);
    return Number.isFinite(n) ? n : undefined;
  })();
  const selectedDetail = useImageDetail(urlImageId);

  // Prefetch an image's similar-set on hover so opening it is instant.
  // The first similarity query otherwise pays a one-time cosine-cache
  // warm + the fusion compute; react-query then caches the result per
  // image. Hovering before clicking (the normal path) hides that latency.
  const prefetchSimilar = useCallback(
    (imageId: number) => {
      queryClient.prefetchQuery({
        queryKey: ["fused-similar-images", imageId, prefs.imageEncoder, 30],
        queryFn: () => fetchFusedSimilarImages(imageId, 30),
        staleTime: 5 * 60 * 1000,
      });
      // Also hydrate the image's full detail (tags + full-res URL) so a
      // click after hover selects a fully hydrated item synchronously.
      prefetchImageDetails(queryClient, [imageId]).catch(() => {});
    },
    [queryClient, prefs.imageEncoder],
  );

  // Determine which images to display:
  // Priority: 1) Similar images (when image selected) > 2) Semantic search > 3) All images
  const displayImages = useMemo(() => {
    // 1. If an image is selected, show tiered similar images
    if (selectedItem && tieredSimilarImages.data) {
      return tieredSimilarImages.data.map((sim) => ({
        id: sim.id,
        url: sim.url,
        thumbnailUrl: sim.thumbnailUrl,
        hasThumbnail: true,
        width: sim.width,
        height: sim.height,
        name: sim.name || "",
        tags: [] as Tag[],
      }));
    }

    // 2. If semantic search is active and has results, show those
    if (shouldUseSemanticSearch && semanticSearchResults.data) {
      return semanticSearchResults.data.map((sim) => ({
        id: sim.id,
        url: sim.url,
        thumbnailUrl: sim.thumbnailUrl,
        hasThumbnail: true,
        width: sim.width,
        height: sim.height,
        name: sim.name || "",
        tags: [] as Tag[],
      }));
    }

    // 3. Default: the main feed (shuffled + thumbnail-gated + reordered).
    return feed;
  }, [
    selectedItem,
    tieredSimilarImages.data,
    shouldUseSemanticSearch,
    semanticSearchResults.data,
    feed,
  ]);

  // Resolve the selected image from the URL.
  //
  // T3-1 changed the lookup: the compact manifest no longer carries tags
  // or the full-resolution URL, so the hydrated per-id detail query
  // (`useImageDetail`, fetched above as `selectedDetail`) is the
  // authoritative source — it's what keeps the inspector's REAL tags.
  // Because hydration is async (one small `WHERE id IN` IPC, and usually
  // already cached by the click/hover prefetch), selection happens in two
  // steps so the similar-view swap stays as instant as the old
  // synchronous catalogue `find`:
  //   1. SEED — synchronously select the clicked entry from the active
  //      display list (thumbnail as the interim full-res URL, no tags);
  //   2. UPGRADE — swap in the hydrated `ImageItem` the moment it lands.
  //
  // The early-return guard is load-bearing, not an optimisation. When a
  // tag/exclude filter is active and the clicked id falls OUTSIDE it, the
  // id is absent from the manifest; and because `displayImages` flips with
  // `selectedItem` (selecting an image swaps the grid to its similar-set,
  // which never contains the image itself), the naive lookup oscillated the
  // selection null↔id forever — "Maximum update depth exceeded". Once
  // `selectedItem` already matches the URL, we stop re-deriving it — the
  // ONLY same-id transition allowed through is seed→hydrated (and
  // hydrated→refreshed-hydrated after a detail refetch), which converges
  // because `selectedDetail.data` is referentially stable between fetches.
  useEffect(() => {
    const pathId = location.pathname.replace(/\//g, "");
    if (!pathId) {
      setSelectedItem(null);
      setIsInspecting(false);
      // Leaving to the feed root ends the similarity cascade — drop the
      // breadcrumb trail so a later feed click can't inherit a stale one.
      setSimTrail([]);
      return;
    }
    const detail = selectedDetail.data ?? null;
    if (selectedItem?.id.toString() === pathId) {
      // Same id: upgrade the seed (or a stale hydration) in place.
      if (detail && selectedItem !== detail) setSelectedItem(detail);
      return;
    }
    const fromDisplay = displayImages?.find((i) => i.id.toString() === pathId);
    const item = detail ?? (fromDisplay ? seedSelectionItem(fromDisplay) : null);
    setSelectedItem(item);
    if (!item) {
      setIsInspecting(false);
    }
  }, [location, displayImages, selectedDetail.data, selectedItem]);

  // Determine if we're in a loading state
  const isSearchLoading = shouldUseSemanticSearch && semanticSearchResults.isFetching;

  // Drag-to-reorder is a live in-session nudge, offered on the full,
  // unfiltered feed only — reordering any subset (tag-filtered, search, or
  // exclude-filtered) is ambiguous against the shuffle, so it's withheld
  // whenever a filter is active. Not persisted: a reshuffle clears it.
  const reorderEnabled =
    !selectedItem &&
    !shouldUseSemanticSearch &&
    searchTags.length === 0 &&
    excludeTags.length === 0;

  // The manual reorder is a nudge over the UNFILTERED feed. The moment a
  // filter narrows the feed, those ranks are meaningless — and worse, they'd
  // clump the previously-dragged tiles at the top of a folder view. Clear
  // them whenever reorder isn't available (any filter, similar, or search).
  useEffect(() => {
    if (!reorderEnabled) {
      setSessionOrder(null);
      setPlacementAnchors({});
    }
  }, [reorderEnabled]);

  // Stable across renders so Masonry's `handleItemClick`/reorder/resize
  // callbacks keep identity and the memo'd tiles hold through an indexing
  // run's route re-renders (T2-1). `recordAction` is a module import and the
  // state setter / mutation `.mutate` are referentially stable.
  // Placement-anchor tops are pixels in the pack's coordinate basis; when
  // the engine reports that basis changed (window resize, column count or
  // tile scale), the pins are meaningless in the new space and must clear —
  // a stale pin would reserve an old-space rectangle and strand its tile in
  // a void. Identity-stable when already empty so no redundant repack fires.
  const handleGeometryBasisChanged = useCallback(() => {
    setPlacementAnchors((prev) => (Object.keys(prev).length ? {} : prev));
  }, []);

  const handleReorder = useCallback(
    (
      orderedIds: number[],
      anchor: { id: number; startCol: number; top: number },
    ) => {
      recordAction("masonry_reorder", {
        count: orderedIds.length,
        id: anchor.id,
        startCol: anchor.startCol,
        top: anchor.top,
      });
      setSessionOrder(orderedIds);
      setPlacementAnchors((prev) => ({
        ...prev,
        [anchor.id]: { startCol: anchor.startCol, top: anchor.top },
      }));
    },
    [],
  );

  const handleResizeCommit = useCallback(
    (
      itemId: number,
      colSpan: number | null,
      anchor: MasonryPlacementAnchor,
    ) => {
      recordAction("masonry_resize", {
        id: itemId,
        colSpan,
        startCol: anchor.startCol,
        top: anchor.top,
      });
      // useTileResize retains the final footprint until this promise settles.
      // The optimistic manifest stamp therefore becomes authoritative before
      // the preview can clear; no intermediate render can repack the tile as
      // its stale 1x1 span. The placement pin lands only on SUCCESS — a failed
      // persistence rolls the span back, and a pin surviving that rollback
      // would strand the tile in a column its span no longer justifies. The
      // footprint stays live until this promise settles, so the pin is
      // committed before the settle pack ever runs.
      const persisted = setManualColSpanMutation.mutateAsync({
        imageId: itemId,
        colSpan,
      });
      void persisted.then(() => {
        setPlacementAnchors((prev) => ({
          ...prev,
          [itemId]: { startCol: anchor.startCol, top: anchor.top },
        }));
      });
      return persisted;
    },
    [setManualColSpanMutation.mutateAsync],
  );

  // Wordmark → back to the main library feed from anywhere: clear any
  // search / tag filter and any selected image, then navigate home. The
  // entry effect re-shuffles the feed on the way back.
  const handleGoHome = () => {
    recordAction("go_home", { via: "wordmark" });
    setSearchTags([]);
    setExcludeTags([]);
    setSearchText("");
    setIsInspecting(false);
    navigate("/");
  };

  // TopBar's two fat handlers, built here (not inside TopBar) per the
  // modularisation gate: onSearchChange carries the leave-first invariant
  // (typing a semantic query while a similar-set is open exits it now,
  // rather than letting the query silently explode onto the feed once the
  // image closes); onAddFolder owns the duplicate-folder confirm + mutation
  // flow. Both are prebuilt callbacks passed down as props.
  const handleSearchChange = (selectedTags: Tag[], text: string) => {
    recordAction("search_change", {
      text,
      tagIds: selectedTags.map((t) => t.id),
    });
    setSearchTags(selectedTags);
    setSearchText(text);
    const q = text.trim();
    if (q.length > 0 && !q.startsWith("#") && selectedItem) {
      navigate("/");
    }
  };

  const handleCreateTag = async (name: string, color: string) => {
    const tag = await createTagMutation.mutateAsync({ name, color });
    return tag;
  };

  const handleAddFolder = async () => {
    try {
      const folder = await pickScanFolder();
      if (!folder) return; // user cancelled
      // Pre-empt the backend UNIQUE constraint with a friendly message. The
      // backend still rejects duplicates as a safety net (the cache could
      // be stale on cold start).
      if (roots?.some((r) => r.path === folder)) {
        await confirm({
          title: "Folder already added",
          description: "That folder is already in your library.",
          alert: true,
        });
        return;
      }
      recordAction("folder_add", { path: folder, via: "topbar" });
      await addRootMutation.mutateAsync(folder);
    } catch (err) {
      console.error("Folder picker failed:", err);
      await confirm({
        title: "Could not add folder",
        description: err instanceof Error ? err.message : String(err),
        alert: true,
      });
    }
  };

  const handleClose = () => {
    recordAction("image_close", { id: selectedItem?.id });
    setIsInspecting(false);
    setSimTrail([]);
    // Navigating home clears selectedItem; the entry effect above treats
    // that as a return to the feed and re-shuffles.
    navigate("/");
  };

  const handleCloseInspect = () => {
    recordAction("inspect_close", { id: selectedItem?.id });
    setIsInspecting(false);
    setPendingTimerStart(null);
  };

  // A selection change orphans any pending quick-start config — clear it so
  // it can never fire against a different image than the one it was built on.
  useEffect(() => {
    setPendingTimerStart(null);
  }, [selectedItem?.id]);

  // Quick-start from the hero pill: open the inspector with a timer config
  // that GestureTimer auto-starts (one start per config object identity).
  // Cleared on inspector close and on selection change so a stale config can
  // never re-fire against a different image.
  const handlePillStart = useCallback((config: GestureTimerConfig) => {
    recordAction("timer_quick_start", { interval: config.intervalSeconds });
    setPendingTimerStart(config);
    setIsInspecting(true);
  }, []);

  // The overlay element is memoised so MasonryItem's by-reference comparator
  // only sees a new overlay when its real inputs change. It carries the
  // timer pill, inert until the hero is hovered/focused (App.css), so it
  // never steals the hero click.
  const heroOverlay = useMemo(() => {
    if (!selectedItem) return undefined;
    return (
      <SelectedImageTimerPill
        similarCount={tieredSimilarImages.data?.length ?? 0}
        disabled={tieredSimilarImages.isLoading}
        onStart={handlePillStart}
      />
    );
  }, [
    selectedItem,
    tieredSimilarImages.data?.length,
    tieredSimilarImages.isLoading,
    handlePillStart,
  ]);

  const handleNavigate = (direction: "prev" | "next") => {
    if (!selectedItem) return;
    // Companion to the selection-lookup fix above: arrow navigation
    // must walk the ACTIVE result list, not the global catalogue.
    // Otherwise pressing "next" on a semantic-search result jumps to
    // a random catalogue tile that has nothing to do with the search.
    // displayImages is the active list (similar-images > semantic >
    // feed); it is always an array, so it IS the walk list.
    const navList = displayImages;
    if (!navList || navList.length === 0) return;
    const currentIndex = navList.findIndex((i) => i.id === selectedItem.id);
    if (currentIndex === -1) return;

    let newIndex: number;
    if (direction === "prev") {
      newIndex = currentIndex > 0 ? currentIndex - 1 : navList.length - 1;
    } else {
      newIndex = currentIndex < navList.length - 1 ? currentIndex + 1 : 0;
    }
    const target = navList[newIndex];
    recordAction("image_navigate", { direction, from: selectedItem.id, to: target.id });
    navigate(`/${target.id}/`);
  };

  // The modal predecodes its arrow-nav neighbours so next/prev is instant.
  // Same wrap-around walk as handleNavigate, over the same active list.
  // A feed neighbour (compact manifest entry) has no full-res URL yet —
  // predecode its thumbnail instead, and batch-hydrate both neighbours'
  // details below so the full-res URL is there by the time an arrow
  // lands on them.
  const modalNeighbourUrls = useMemo(() => {
    if (!selectedItem) return undefined;
    const navList = displayImages;
    if (!navList || navList.length === 0) return undefined;
    const currentIndex = navList.findIndex((i) => i.id === selectedItem.id);
    if (currentIndex === -1) return undefined;
    const prev = navList[currentIndex > 0 ? currentIndex - 1 : navList.length - 1];
    const next = navList[currentIndex < navList.length - 1 ? currentIndex + 1 : 0];
    return {
      prev: prev?.url ?? prev?.thumbnailUrl,
      next: next?.url ?? next?.thumbnailUrl,
      prevId: prev?.id,
      nextId: next?.id,
    };
  }, [selectedItem, displayImages]);

  // Hydrate the two arrow-nav neighbours while the modal is up (one
  // batched IPC, cache-deduped) so navigating to them selects a fully
  // hydrated item synchronously.
  useEffect(() => {
    if (!isInspecting || !modalNeighbourUrls) return;
    const ids = [modalNeighbourUrls.prevId, modalNeighbourUrls.nextId].filter(
      (id): id is number => id !== undefined,
    );
    if (ids.length > 0) {
      prefetchImageDetails(queryClient, ids).catch(() => {
        // Non-fatal — arrow-nav falls back to seed-then-upgrade.
      });
    }
  }, [isInspecting, modalNeighbourUrls, queryClient]);

  // Handle clicking on an image in the grid. Memoised so the grid's tile
  // memo holds; its identity only changes when the selection context it reads
  // (selectedItem / shouldUseSemanticSearch) changes — never on an indexing
  // event — so the render storm can't reach the tiles through it.
  const handleImageClick = useCallback(
    (item: FeedItem) => {
      if (selectedItem && selectedItem.id === item.id) {
        // Clicking on the already-selected image → open inspect modal
        recordAction("image_inspect", { id: item.id });
        setIsInspecting(true);
      } else {
        // Clicking on a different image → select it
        recordAction("image_click", { id: item.id });
        // Kick the detail hydration now (no-op if the hover prefetch
        // already cached it) so the seed→hydrated upgrade is immediate.
        prefetchImageDetails(queryClient, [item.id]).catch(() => {});
        // Diving deeper into a similarity cascade (already viewing an
        // image's similar-set, now clicking one of those) → remember the
        // current image so "back one hop" can return to it.
        if (selectedItem && !shouldUseSemanticSearch) {
          setSimTrail((t) => [...t, selectedItem]);
        }
        navigate(`/${item.id}/`);
      }
    },
    [selectedItem, shouldUseSemanticSearch, navigate, queryClient],
  );

  // Back one similarity hop — return to the previous image in the trail.
  const handleBackHop = () => {
    const prev = simTrail[simTrail.length - 1];
    if (!prev) return;
    recordAction("similarity_back", { to: prev.id });
    setSimTrail((t) => t.slice(0, -1));
    navigate(`/${prev.id}/`);
  };

  // Rewind to a specific image in the breadcrumb trail (drop everything
  // after it).
  const handleRewindTo = (index: number) => {
    const target = simTrail[index];
    if (!target) return;
    recordAction("similarity_rewind", { to: target.id, index });
    setSimTrail((t) => t.slice(0, index));
    navigate(`/${target.id}/`);
  };

  return (
    <main className="app-canvas relative h-[100dvh] w-screen overflow-hidden bg-background text-foreground">
      {/* Live indexing-progress pill (top-right corner) */}
      <IndexingStatusPill />

      {/* Settings bubble — pops out near the gear icon, non-modal. */}
      <SettingsDrawer
        open={settings.open}
        pinned={settings.pinned}
        onClose={settings.close}
        panelProps={settings.panelProps}
        triggerRef={settings.triggerRef}
      />

      {/* Library bubble — folders-as-tags, pops out near the library icon,
          non-modal. Its include set is the shared `searchTags`; exclude is
          `excludeTags`. */}
      <LibraryDrawer
        id="library-drawer"
        open={library.open}
        pinned={library.pinned}
        onClose={library.close}
        panelProps={library.panelProps}
        triggerRef={library.triggerRef}
        tags={libraryTags}
        totalImageCount={totalVisibleImages}
        activeTagId={activeFolderId}
        includeTagIds={includeTagIds}
        excludeTagIds={excludeTagIdSet}
        onSelectFolder={handleSelectFolder}
        onSetTagFilter={handleSetTagFilter}
        onClearFilters={handleClearFilters}
        loading={tags.isLoading || tagCounts.isLoading}
        errorMessage={
          tags.isError
            ? "Could not load your tags."
            : tagCounts.isError
              ? "Could not load folder counts."
              : null
        }
      />

      {/* Performance overlay — toggled with ⌘⇧P */}
      {profiling && (
        <PerfOverlay open={perfOpen} onClose={() => setPerfOpen(false)} />
      )}

      {/* Pinterest Modal (inspect mode) - only shows when inspecting a selected image */}
      <AnimatePresence>
        {selectedItem && isInspecting && (
          <PinterestModal
            item={selectedItem}
            timerCandidates={tieredSimilarImages.data ?? []}
            neighbourUrls={modalNeighbourUrls}
            autoStartTimer={pendingTimerStart}
            onClose={handleCloseInspect}
            onNavigate={handleNavigate}
            tags={tags.data}
            onCreateTag={async (name, color) => {
              const tag = await createTagMutation.mutateAsync({ name, color });
              return tag;
            }}
            onDeleteTag={(tagId) => deleteTagMutation.mutate(tagId)}
            onAssignTag={(imageId, tagId) =>
              assignTagMutation.mutate({ imageId, tagId })
            }
            onRemoveTag={(imageId, tagId) =>
              removeTagMutation.mutate({ imageId, tagId })
            }
            notes={activeNotes}
            onSaveNotes={(imageId, notes) => {
              setActiveNotes(notes);
              // Fire-and-forget — non-fatal failure logs but doesn't
              // block the user. The textarea stays in sync via local state.
              setImageNotes(imageId, notes).catch((err) =>
                console.warn("Failed to save notes:", err),
              );
            }}
          />
        )}
      </AnimatePresence>

      <div className="h-full w-full overflow-y-auto overscroll-contain">
        {/* Search Bar + folder-picker control */}
        <TopBar
          libraryOpen={library.open}
          libraryTriggerProps={library.triggerProps}
          libraryTriggerRef={library.triggerRef}
          settingsOpen={settings.open}
          settingsTriggerProps={{
            ...settings.triggerProps,
            onClick: () => {
              recordAction(settings.pinned ? "settings_close" : "settings_open", {
                via: "button",
              });
              settings.togglePinned();
            },
          }}
          settingsTriggerRef={settings.triggerRef}
          onGoHome={handleGoHome}
          tags={tags.data}
          searchTags={searchTags}
          searchText={searchText}
          searchMode={searchMode}
          onSearchChange={handleSearchChange}
          onCreateTag={handleCreateTag}
          onAddFolder={handleAddFolder}
        />

        <div className="box-border w-full px-5 pb-16 pt-7 md:px-8 lg:px-10 lg:pt-9">

        {/* First-launch / empty-state hint. The feed is thumbnail-gated,
            so during early indexing it can be empty while images already
            exist — show an "indexing" state then, and "no images yet"
            only when the library is genuinely empty and nothing is in
            flight. */}
        {!selectedItem &&
          !shouldUseSemanticSearch &&
          feed.length === 0 && (
            <EmptyState isIndexing={isIndexing} manifestCount={manifest.data?.length} />
          )}

        {/* Section header when viewing similar images */}
        <SimilarHeader
          selectedItem={selectedItem}
          simTrail={simTrail}
          isFetchingSimilar={tieredSimilarImages.isFetching}
          similarCount={tieredSimilarImages.data?.length || 0}
          onRewindTo={handleRewindTo}
          onBackHop={handleBackHop}
          onClose={handleClose}
        />

        {/* Semantic search status */}
        <SemanticStatus
          visible={shouldUseSemanticSearch && !selectedItem}
          isSearchLoading={isSearchLoading}
          semanticQuery={semanticQuery}
          resultsCount={semanticSearchResults.data?.length}
          isError={semanticSearchResults.isError}
          error={semanticSearchResults.error}
        />

        {/* Masonry Grid — column count and animation level driven by user prefs.
            Wrapped in React.Profiler so the profiling system can correlate
            slow grid renders with backend spans + user actions. The profiler
            callback is a no-op when profiling is off (recordAction
            short-circuits on the cached flag), so this is zero-cost in
            normal use. Renders < 5ms are filtered out at the callback to
            avoid noise from every-keystroke re-renders. */}
        <Profiler id="Masonry" onRender={onRenderProfiler}>
          <Masonry
            items={displayImages}
            selectedItem={selectedItem}
            columnGap={16}
            verticalGap={16}
            minItemWidth={236}
            columnCountOverride={prefs.columnCount}
            tileScale={prefs.tileScale}
            animationLevel={prefs.animationLevel}
            onItemClick={handleImageClick}
            reorderEnabled={reorderEnabled}
            onReorder={handleReorder}
            onResizeCommit={handleResizeCommit}
            placementAnchors={placementAnchors}
            onGeometryBasisChanged={handleGeometryBasisChanged}
            onItemHover={prefetchSimilar}
            heroOverlay={heroOverlay}
          />
        </Profiler>
      </div>
      </div>
    </main>
  );
}
