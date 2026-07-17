import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { IndexingStatus } from "../hooks/useIndexingStatus";

/**
 * Tests for the IndexingStatusPill component.
 *
 * The pill reads the `useIndexingStatus` hook and decides whether to
 * render and how. We mock the hook so each test injects a status shape
 * and exercises the visibility / rendering rules without real Tauri
 * events or DB queries. Displayed numbers come from `overall` (the
 * DB-derived aggregate), never from a raw event — that's the whole point
 * of the single-source-of-truth rework.
 */

function status(overrides: Partial<IndexingStatus>): IndexingStatus {
  return {
    isIndexing: false,
    phase: null,
    message: null,
    eventFraction: null,
    overall: { processed: 0, total: 0, fraction: 0 },
    stats: null,
    ...overrides,
  };
}

let mockStatus: IndexingStatus = status({});

vi.mock("../hooks/useIndexingStatus", () => ({
  useIndexingStatus: () => mockStatus,
}));

import { IndexingStatusPill } from "./IndexingStatusPill";

function renderPill() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <IndexingStatusPill />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockStatus = status({});
});

describe("IndexingStatusPill", () => {
  it("renders nothing when idle (no phase, not indexing)", () => {
    mockStatus = status({});
    renderPill();
    expect(screen.queryByText(/Scanning/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Encoding/i)).not.toBeInTheDocument();
  });

  it("renders 'Scanning' during the scan phase", () => {
    mockStatus = status({ isIndexing: true, phase: "scan" });
    renderPill();
    expect(screen.getByText(/Scanning/i)).toBeInTheDocument();
  });

  it("shows the DB-derived aggregate percentage while encoding", () => {
    mockStatus = status({
      isIndexing: true,
      phase: "encode",
      overall: { processed: 61, total: 84, fraction: 61 / 84 },
    });
    renderPill();
    expect(screen.getByText(/Encoding embeddings/i)).toBeInTheDocument();
    // 61 / 84 = 72.6% → rounds to 73%.
    expect(screen.getByText("73%")).toBeInTheDocument();
  });

  it("prefers the per-image event fraction over the DB aggregate while active", () => {
    // T1-1: during an active run the pill climbs with the current phase's
    // per-image event fraction, not the coarser whole-pipeline DB aggregate.
    mockStatus = status({
      isIndexing: true,
      phase: "encode",
      eventFraction: 0.42,
      overall: { processed: 61, total: 84, fraction: 61 / 84 },
    });
    renderPill();
    // 0.42 → 42%, NOT the aggregate's 73%.
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.queryByText("73%")).not.toBeInTheDocument();
  });

  it("renders the 'Error' state when phase is error", () => {
    mockStatus = status({
      phase: "error",
      message: "Indexing failed: model not found",
    });
    renderPill();
    expect(screen.getByText(/Error/i)).toBeInTheDocument();
  });

  it("does not show a percentage bar when not actively indexing", () => {
    mockStatus = status({ phase: "error", message: "boom" });
    renderPill();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it("shows a 'Ready' confirmation once a run finishes", () => {
    mockStatus = status({ isIndexing: true, phase: "encode" });
    const { rerender } = renderPill();
    // Run completes: still on the encode phase label, but no longer active.
    mockStatus = status({ isIndexing: false, phase: "encode" });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <IndexingStatusPill />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Ready/i)).toBeInTheDocument();
  });

  it("uses the status message as the title attribute", () => {
    mockStatus = status({
      isIndexing: true,
      phase: "scan",
      message: "Scanning /Users/me/photos",
    });
    const { container } = renderPill();
    const pill = container.querySelector("[title]");
    expect(pill).toHaveAttribute("title", "Scanning /Users/me/photos");
  });
});
