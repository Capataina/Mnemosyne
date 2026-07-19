import { useCallback, useEffect, useRef, useState, useMemo, Profiler } from "react";
import Masonry from "../components/Masonry";
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
import { LibraryDrawer, LibraryMenuButton } from "@/components/library-drawer";
import { useConfirm } from "@/components/ui/confirm";
import { getTagCounts } from "@/services/tags";
import { FeedItem, ImageItem, Tag } from "../types";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router";
import { useTags, useCreateTag, useDeleteTag } from "@/queries/useTags";
import { SearchBar } from "@/components/SearchBar";
import { PinterestModal } from "@/components/PinterestModal";
import { IndexingStatusPill } from "@/components/IndexingStatusPill";
import { SettingsDrawer } from "@/components/settings";
import { PerfOverlay } from "@/components/PerfOverlay";
import { isProfilingEnabled, recordAction, onRenderProfiler } from "@/services/perf";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Settings as SettingsIcon } from "lucide-react";
import { pickScanFolder, fetchFusedSimilarImages } from "@/services/images";
import { useAddRoot, useRoots } from "@/queries/useRoots";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { getImageNotes, setImageNotes } from "@/services/notes";
import { SelectedImageTimerPill } from "@/components/SelectedImageTimerPill";
import { HeroExpandButton } from "@/components/HeroExpandButton";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Profiling state — flipped to true once at mount if the binary was
  // launched with `--profile`. Drives three things: whether the perf
  // overlay mounts at all, whether cmd+shift+P does anything, and
  // (later) whether action breadcrumbs get emitted to the backend.
  // Without `--profile`, every profiling-related code path stays cold.
  const [profiling, setProfiling] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const { prefs } = useUserPreferences();
  const { data: roots } = useRoots();
  const addRootMutation = useAddRoot();

  // Resolve the profiling flag once at mount. When set, auto-open the
  // overlay so the user doesn't have to discover the cmd+shift+P
  // shortcut — if you started the app with --profile, you wanted to
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
        setSettingsOpen((s) => {
          recordAction(s ? "settings_close" : "settings_open", { via: "shortcut" });
          return !s;
        });
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
  }, [profiling]);

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
  // Session column pins (tile id -> left column) for gesture-placed tiles:
  // a dropped or resized tile keeps the column the gesture preview showed,
  // instead of being re-derived by the packer's global argmin on every
  // subsequent pack. Shares the session order's lifecycle exactly.
  const [columnAnchors, setColumnAnchors] = useState<Record<number, number>>(
    {},
  );
  // Similarity navigation trail: the images dived through via
  // similar→click→similar. Powers back-one-hop + a breadcrumb strip so a
  // deep cascade stays navigable (the UX council's top pick). Cleared on
  // return to the feed.
  const [simTrail, setSimTrail] = useState<ImageItem[]>([]);
  // Library drawer (folders-as-tags): its open state + the exclude-tag
  // ("must not have") filter set. The include set is `searchTags`, shared
  // with the search bar; the open-folder highlight is DERIVED from it below.
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [excludeTags, setExcludeTags] = useState<Tag[]>([]);
  const confirm = useConfirm();

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
      setColumnAnchors({});
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
      setColumnAnchors({});
    }
  }, [reorderEnabled]);

  // Stable across renders so Masonry's `handleItemClick`/reorder/resize
  // callbacks keep identity and the memo'd tiles hold through an indexing
  // run's route re-renders (T2-1). `recordAction` is a module import and the
  // state setter / mutation `.mutate` are referentially stable.
  const handleReorder = useCallback(
    (orderedIds: number[], anchor: { id: number; startCol: number }) => {
      recordAction("masonry_reorder", {
        count: orderedIds.length,
        id: anchor.id,
        startCol: anchor.startCol,
      });
      setSessionOrder(orderedIds);
      setColumnAnchors((prev) => ({ ...prev, [anchor.id]: anchor.startCol }));
    },
    [],
  );

  const handleResizeCommit = useCallback(
    (itemId: number, colSpan: number | null, startCol: number) => {
      recordAction("masonry_resize", { id: itemId, colSpan, startCol });
      // useTileResize retains the final footprint until this promise settles.
      // The optimistic manifest stamp therefore becomes authoritative before
      // the preview can clear; no intermediate render can repack the tile as
      // its stale 1x1 span. The column pin lands only on SUCCESS — a failed
      // persistence rolls the span back, and a pin surviving that rollback
      // would strand the tile in a column its span no longer justifies. The
      // footprint stays live until this promise settles, so the pin is
      // committed before the settle pack ever runs.
      const persisted = setManualColSpanMutation.mutateAsync({
        imageId: itemId,
        colSpan,
      });
      void persisted.then(() => {
        setColumnAnchors((prev) => ({ ...prev, [itemId]: startCol }));
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

  // Direct expand from the hero's top-middle button — open the inspector
  // for the current selection without the second click-through-similarity.
  const handleExpandHero = useCallback(() => {
    recordAction("image_inspect", { via: "hero_expand" });
    setIsInspecting(true);
  }, []);

  // The overlay element is memoised so MasonryItem's by-reference comparator
  // only sees a new overlay when its real inputs change. It carries the
  // expand button (top) and the timer pill (bottom); both are inert until
  // the hero is hovered/focused (App.css), so neither steals the hero click.
  const heroOverlay = useMemo(() => {
    if (!selectedItem) return undefined;
    return (
      <>
        <HeroExpandButton onExpand={handleExpandHero} />
        <SelectedImageTimerPill
          similarCount={tieredSimilarImages.data?.length ?? 0}
          disabled={tieredSimilarImages.isLoading}
          onStart={handlePillStart}
        />
      </>
    );
  }, [
    selectedItem,
    tieredSimilarImages.data?.length,
    tieredSimilarImages.isLoading,
    handlePillStart,
    handleExpandHero,
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

      {/* Settings drawer — slides in from the right */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Library drawer — folders-as-tags, slides in from the left. Its
          include set is the shared `searchTags`; exclude is `excludeTags`. */}
      <LibraryDrawer
        id="library-drawer"
        open={libraryDrawerOpen}
        onClose={() => setLibraryDrawerOpen(false)}
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
        <header className="chrome-surface sticky top-0 z-40 border-b">
          <div className="mx-auto flex h-[72px] w-full items-center gap-3 px-5 md:px-8 lg:gap-4 lg:px-10">
            {/* Library drawer toggle (folders-as-tags) — always visible, the
                left-most anchor of the top bar. */}
            <LibraryMenuButton
              open={libraryDrawerOpen}
              onOpen={() => setLibraryDrawerOpen(true)}
              drawerId="library-drawer"
            />
            <div className="hidden w-32 shrink-0 items-center xl:flex">
              <button
                type="button"
                onClick={handleGoHome}
                aria-label="Lynceus — back to library"
                title="Back to library"
                className="cursor-pointer rounded-[8px] px-1 py-0.5 text-[15px] font-[650] tracking-[-0.035em] text-foreground transition-opacity hover:opacity-70 active:scale-[0.98]"
              >
                Lynceus
              </button>
            </div>

            <div className="mx-auto min-w-0 max-w-3xl flex-1">
              <SearchBar
                tags={tags.data}
                selectedTags={searchTags}
                searchText={searchText}
                mode={searchMode}
                onSearchChange={(selectedTags, text) => {
                  recordAction("search_change", {
                    text,
                    tagIds: selectedTags.map((t) => t.id),
                  });
                  setSearchTags(selectedTags);
                  setSearchText(text);
                  // Typing a semantic query while an image's similar-set is
                  // open would otherwise be silently deferred (the query is
                  // suppressed while selectedItem is set) and then "explode"
                  // onto the feed when the image closes. Exit the similar
                  // view now so the search runs immediately and visibly.
                  const q = text.trim();
                  if (q.length > 0 && !q.startsWith("#") && selectedItem) {
                    navigate("/");
                  }
                }}
                placeholder="Search images or type # to filter by tags..."
                onCreateTag={async (name, color) => {
                  const tag = await createTagMutation.mutateAsync({
                    name,
                    color,
                  });
                  return tag;
                }}
              />
            </div>

            <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              title="Add image folder"
              aria-label="Add image folder"
              className="flex h-10 shrink-0 items-center gap-2 rounded-[10px] border border-border-strong bg-surface-raised/65 px-3.5 text-[12px] font-[560] text-secondary-foreground transition-[background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.98]"
              onClick={async () => {
                try {
                  const folder = await pickScanFolder();
                  if (!folder) return; // user cancelled
                  // Pre-empt the backend UNIQUE constraint with a friendly
                  // message. The backend still rejects duplicates as a
                  // safety net (the cache could be stale on cold start).
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
                    description:
                      err instanceof Error ? err.message : String(err),
                    alert: true,
                  });
                }
              }}
            >
              <FolderPlus className="h-4 w-4" strokeWidth={1.8} />
              <span className="hidden md:inline">Add folder</span>
            </button>

            <button
              type="button"
              title="Settings (⌘,)"
              aria-label="Settings"
              className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-border bg-surface/60 text-muted-foreground transition-[color,background-color,border-color,transform] hover:border-border-strong hover:bg-accent hover:text-foreground active:scale-[0.98]"
              onClick={() => {
                recordAction("settings_open", { via: "button" });
                setSettingsOpen(true);
              }}
            >
              <SettingsIcon className="h-4 w-4" strokeWidth={1.8} />
            </button>
            </div>
          </div>
        </header>

        <div className="box-border w-full px-5 pb-16 pt-7 md:px-8 lg:px-10 lg:pt-9">

        {/* First-launch / empty-state hint. The feed is thumbnail-gated,
            so during early indexing it can be empty while images already
            exist — show an "indexing" state then, and "no images yet"
            only when the library is genuinely empty and nothing is in
            flight. */}
        {!selectedItem &&
          !shouldUseSemanticSearch &&
          feed.length === 0 &&
          (isIndexing || (manifest.data && manifest.data.length > 0) ? (
            <section className="mx-auto mb-12 flex min-h-[340px] max-w-2xl flex-col items-center justify-center text-center">
              <div className="mb-7 flex h-24 items-end gap-2.5" aria-hidden="true">
                <div className="skeleton-tile h-16 w-16 rounded-[10px]" />
                <div className="skeleton-tile h-24 w-20 rounded-[10px]" />
                <div className="skeleton-tile h-20 w-14 rounded-[10px]" />
              </div>
              <h2 className="mb-2 text-[22px] font-[620] tracking-[-0.035em] text-foreground">
                Indexing your library…
              </h2>
              <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
                Tiles appear here as each image's thumbnail is generated.
                You can keep using the app while indexing runs in the
                background.
              </p>
            </section>
          ) : manifest.data && manifest.data.length === 0 ? (
            <section className="mx-auto mb-12 flex min-h-[340px] max-w-2xl flex-col items-center justify-center text-center">
              <div className="mb-6 grid size-14 place-items-center rounded-[14px] border border-border bg-surface text-muted-foreground shadow-[var(--shadow-soft)]">
                <FolderPlus className="h-5 w-5" strokeWidth={1.6} />
              </div>
              <h2 className="mb-2 text-[22px] font-[620] tracking-[-0.035em] text-foreground">
                No images yet
              </h2>
              <p className="max-w-lg text-[13px] leading-relaxed text-muted-foreground">
                Pick a folder above to start indexing your library. The app
                searches recursively, so you can point it at a parent folder
                and let it sweep through every subfolder.
              </p>
            </section>
          ) : null)}

        {/* Section header when viewing similar images */}
        <AnimatePresence>
          {selectedItem && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-7 flex flex-col gap-4 border-b border-border pb-5"
            >
              {/* Similarity breadcrumb trail — the images dived through to
                  reach here; click any thumbnail to rewind to that fork. */}
              {simTrail.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {simTrail.map((img, i) => (
                    <button
                      key={`${img.id}-${i}`}
                      onClick={() => handleRewindTo(i)}
                      title={`Back to ${img.name}`}
                      className="group flex shrink-0 items-center gap-1.5"
                    >
                      <img
                        src={img.thumbnailUrl ?? img.url}
                        alt={img.name}
                        className="h-8 w-8 rounded-[7px] object-cover opacity-65 ring-1 ring-border transition-opacity group-hover:opacity-100"
                      />
                      <span className="text-[11px] text-muted-foreground">›</span>
                    </button>
                  ))}
                  <img
                    src={selectedItem.thumbnailUrl ?? selectedItem.url}
                    alt={selectedItem.name}
                    className="h-8 w-8 shrink-0 rounded-[7px] object-cover ring-2 ring-primary/60"
                  />
                </div>
              )}

              <div className="flex items-end justify-between gap-5">
                <div>
                  <h2 className="text-[24px] font-[620] tracking-[-0.04em] text-foreground">
                    More like this
                  </h2>
                  <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
                    {tieredSimilarImages.isFetching
                      ? "Finding similar images..."
                      : `${tieredSimilarImages.data?.length || 0} similar images`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {simTrail.length > 0 && (
                    <button
                      onClick={handleBackHop}
                      className="h-9 rounded-[10px] border border-border bg-surface/65 px-3.5 text-[12px] font-[560] text-foreground transition-[background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.98]"
                    >
                      ‹ Back one
                    </button>
                  )}
                  <button
                    onClick={handleClose}
                    className="h-9 rounded-[10px] border border-border bg-surface/65 px-3.5 text-[12px] font-[560] text-secondary-foreground transition-[background-color,border-color,transform] hover:border-border-strong hover:bg-accent active:scale-[0.98]"
                  >
                    ← Back to all
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Semantic search status */}
        <AnimatePresence>
          {shouldUseSemanticSearch && !selectedItem && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-7 border-b border-border pb-5"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-[24px] font-[620] tracking-[-0.04em] text-foreground">
                  {isSearchLoading ? (
                    <span className="flex items-center gap-2.5">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-input border-t-primary" />
                      Searching for "{semanticQuery}"...
                    </span>
                  ) : (
                    `Results for "${semanticQuery}"`
                  )}
                </h2>
              </div>
              {!isSearchLoading && semanticSearchResults.data && (
                <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
                  Found {semanticSearchResults.data.length} matching images
                </p>
              )}
              {semanticSearchResults.isError && (
                <p
                  className="mt-2 rounded-[10px] border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12px] text-destructive"
                  title={String(semanticSearchResults.error)}
                >
                  Search failed:{" "}
                  {semanticSearchResults.error instanceof Error
                    ? semanticSearchResults.error.message
                    : String(semanticSearchResults.error)}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

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
            columnAnchors={columnAnchors}
            onItemHover={prefetchSimilar}
            heroOverlay={heroOverlay}
          />
        </Profiler>
      </div>
      </div>
    </main>
  );
}
