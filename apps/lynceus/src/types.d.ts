export type ImageData = {
  path: string;
  name: string;
  tags: Tag[];
  id: number;
  /** Path to the thumbnail image (from backend) */
  thumbnail_path?: string;
  /** Original image width in pixels (from backend) */
  width?: number;
  /** Original image height in pixels (from backend) */
  height?: number;
  /** Free-text annotation (Phase 11) */
  notes?: string | null;
  /** Manual drag-reorder position ("custom" sort mode). Null/undefined
   *  means never manually placed — falls back to id order. */
  manual_order?: number | null;
  /** Manual drag-resize column span. Null/undefined means the default
   *  single-column width. */
  manual_col_span?: number | null;
};

export type ImageItem = {
  id: number;
  /** Full resolution image URL */
  url: string;
  /** Base (smallest-bucket) thumbnail URL for grid display. Undefined
   *  until the thumbnail has been generated — see `hasThumbnail`. */
  thumbnailUrl?: string;
  /** True once a thumbnail exists on disk. The main feed only shows
   *  images where this is true, so nothing pops in blank during
   *  indexing. */
  hasThumbnail: boolean;
  width: number;
  height: number;
  name: string;
  tags: Tag[];
  /** Free-text annotation (Phase 11) */
  notes?: string | null;
  /** Manual drag-reorder position ("custom" sort mode). Null/undefined
   *  means never manually placed — falls back to id order. */
  manualOrder?: number | null;
  /** Manual drag-resize column span. Null/undefined means the default
   *  single-column width. */
  manualColSpan?: number | null;
};

/** Wire shape of one `get_feed_manifest` row / `feed-delta` row (T3-1).
 *  Compact by design: no tags, no notes, no original path — the
 *  thumbnail path is the only path a feed tile renders. `feed-delta`
 *  rows are this shape minus `manual_col_span` (deltas never carry a
 *  span; the merge preserves any existing one). */
export type FeedManifestRowDTO = {
  id: number;
  name: string;
  width?: number | null;
  height?: number | null;
  thumbnail_path?: string | null;
  manual_col_span?: number | null;
};

/** What the grid layers (shuffle → pack → tile) consume. The compact
 *  manifest maps to exactly this; a full `ImageItem` (hydrated detail,
 *  search/similar results) is structurally assignable to it, so both
 *  flow through the same Masonry props. `url` is only present on
 *  hydrated/search items — a feed tile renders its thumbnail, and the
 *  selected hero is always a hydrated `ImageItem`. */
export type FeedItem = {
  id: number;
  name: string;
  /** Full-resolution URL; present on hydrated detail and search results,
   *  absent on compact manifest entries. */
  url?: string;
  thumbnailUrl?: string;
  hasThumbnail: boolean;
  width: number;
  height: number;
  manualColSpan?: number | null;
};

export type Tag = {
  id: number;
  name: string;
  color: string;
};

export type SimilarImageItem = {
  id: number;
  path: string;
  /** Full resolution image URL */
  url: string;
  /** Thumbnail image URL (for grid display) */
  thumbnailUrl?: string;
  width: number;
  height: number;
  score: number;
  name?: string;
};

/** A configured scan root (multi-folder support, Phase 6). */
export type Root = {
  id: number;
  path: string;
  enabled: boolean;
  /** Unix epoch seconds */
  added_at: number;
};
