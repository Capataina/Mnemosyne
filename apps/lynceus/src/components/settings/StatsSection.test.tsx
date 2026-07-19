import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const indexingStatus = {
  isIndexing: false,
  phase: "ready" as string,
  message: null,
  eventFraction: null,
  overall: null,
};

vi.mock("../../hooks/useIndexingStatus", () => ({
  usePipelineStats: () => ({
    total_images: 100,
    with_thumbnail: 80,
    with_embedding_per_encoder: [],
    orphaned: 0,
  }),
  useIndexingStatus: () => indexingStatus,
}));

const usePreviewBreakdown = vi.fn((enabled: boolean) => ({
  data: enabled
    ? [
        { width: 480, done: 80, eligible: 100 },
        { width: 960, done: 40, eligible: 60 },
        { width: 1440, done: 10, eligible: 20 },
        { width: 2048, done: 2, eligible: 5 },
      ]
    : undefined,
}));

vi.mock("../../queries/useImages", () => ({
  usePurgeOrphanedImages: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePreviewBreakdown: (enabled: boolean) => usePreviewBreakdown(enabled),
}));

vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => vi.fn() }));

import { StatsSection } from "./StatsSection";

describe("StatsSection preview breakdown", () => {
  it("keeps the tier rows collapsed until the previews row is clicked, then shows every size", () => {
    render(<StatsSection />);

    // Collapsed: headline count visible, no tier rows, and the
    // breakdown query is disabled (fs walk must not run unopened).
    expect(screen.getByText("80 of 100 images")).toBeDefined();
    expect(screen.queryByText("Medium")).toBeNull();
    expect(usePreviewBreakdown).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /Images with previews/ }));

    expect(usePreviewBreakdown).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Small")).toBeDefined();
    expect(screen.getByText("Medium")).toBeDefined();
    expect(screen.getByText("Large")).toBeDefined();
    expect(screen.getByText("Extra large")).toBeDefined();
    // Per-tier denominators are ELIGIBLE counts, not the library total.
    expect(screen.getByText("40 of 60 images")).toBeDefined();
    expect(screen.getByText("2 of 5 images")).toBeDefined();
  });

  it("narrates incomplete tiers against the live pipeline phase", () => {
    // Larger previews generate LAST — without narration, incomplete
    // tiers during encoding read as broken zeros (the live report).
    indexingStatus.isIndexing = true;
    indexingStatus.phase = "encode";
    const encoding = render(<StatsSection />);
    fireEvent.click(
      encoding.getByRole("button", { name: /Images with previews/ }),
    );
    expect(
      encoding.getAllByText(/queued — runs after encoding/).length,
    ).toBeGreaterThan(0);
    encoding.unmount();

    indexingStatus.phase = "previews";
    const generating = render(<StatsSection />);
    fireEvent.click(
      generating.getByRole("button", { name: /Images with previews/ }),
    );
    expect(generating.getAllByText(/generating now/).length).toBeGreaterThan(0);
    generating.unmount();

    indexingStatus.isIndexing = false;
    indexingStatus.phase = "ready";
  });
});
