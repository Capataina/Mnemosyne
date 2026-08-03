import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { LibraryDrawer } from "./LibraryDrawer";
import type { LibraryDrawerTag } from "./types";

const TAGS: LibraryDrawerTag[] = [
  { id: 1, name: "Travel", color: "#fff", imageCount: 4 },
];

/** A real, focusable, document-attached trigger — so "focus returns to the
 * trigger on close" assertions have somewhere real to land. */
function makeTriggerRef() {
  const ref = createRef<HTMLButtonElement>();
  const trigger = document.createElement("button");
  trigger.textContent = "library trigger";
  document.body.appendChild(trigger);
  (ref as { current: HTMLButtonElement | null }).current = trigger;
  return { ref, trigger };
}

function renderPanel(overrides: Partial<Parameters<typeof LibraryDrawer>[0]> = {}) {
  const onClose = vi.fn();
  const { ref: triggerRef, trigger } = makeTriggerRef();

  const utils = render(
    <LibraryDrawer
      open
      pinned
      onClose={onClose}
      panelProps={{ onMouseEnter: vi.fn(), onMouseLeave: vi.fn() }}
      triggerRef={triggerRef}
      tags={TAGS}
      totalImageCount={12}
      activeTagId={null}
      includeTagIds={new Set()}
      excludeTagIds={new Set()}
      onSelectFolder={vi.fn()}
      onSetTagFilter={vi.fn()}
      {...overrides}
    />,
  );
  return { ...utils, onClose, triggerRef, trigger };
}

describe("LibraryDrawer bubble interaction contract", () => {
  it("renders nothing when not open", () => {
    renderPanel({ open: false, pinned: false });
    expect(screen.queryByText("Travel")).not.toBeInTheDocument();
  });

  it("renders the preserved folder/filter sections when open", () => {
    renderPanel();
    // "All images" appears twice — the folder button, and the header
    // subtitle echoing the active folder ("All images" when none is set).
    expect(screen.getAllByText("All images").length).toBeGreaterThanOrEqual(1);
    // "Travel" appears twice — once in the folder list, once in the
    // include/exclude filter row — both sections are preserved unchanged.
    expect(screen.getAllByText("Travel")).toHaveLength(2);
  });

  it("shows the loading skeleton, deferring to it over the sections", () => {
    renderPanel({ loading: true });
    expect(screen.getByLabelText("Loading tag folders")).toBeInTheDocument();
    expect(screen.queryByText("Travel")).not.toBeInTheDocument();
  });

  it("shows the error message, deferring to it over the sections", () => {
    renderPanel({ errorMessage: "Could not load your tags." });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load your tags.",
    );
    expect(screen.queryByText("Travel")).not.toBeInTheDocument();
  });

  it("Escape calls onClose", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a pointerdown outside the panel and the trigger calls onClose", () => {
    const { onClose } = renderPanel();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a pointerdown on the trigger does NOT call onClose (its own click already toggles pin)", () => {
    const { onClose, trigger } = renderPanel();
    fireEvent.pointerDown(trigger);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a pointerdown inside the panel does NOT call onClose", () => {
    const { onClose } = renderPanel();
    fireEvent.pointerDown(screen.getByLabelText("Library"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the panel when pinned", () => {
    renderPanel({ pinned: true });
    expect(screen.getByLabelText("Library")).toHaveFocus();
  });

  it("returns focus to the trigger once pinned goes false", () => {
    const { rerender, triggerRef, onClose } = renderPanel({ pinned: true });

    rerender(
      <LibraryDrawer
        open={false}
        pinned={false}
        onClose={onClose}
        panelProps={{ onMouseEnter: vi.fn(), onMouseLeave: vi.fn() }}
        triggerRef={triggerRef}
        tags={TAGS}
        totalImageCount={12}
        activeTagId={null}
        includeTagIds={new Set()}
        excludeTagIds={new Set()}
        onSelectFolder={vi.fn()}
        onSetTagFilter={vi.fn()}
      />,
    );

    expect(triggerRef.current).toHaveFocus();
  });

  it("does not steal focus for a hover-only open (pinned=false)", () => {
    renderPanel({ pinned: false, open: true });
    expect(screen.getByLabelText("Library")).not.toHaveFocus();
  });

  it("forwards panel hover handlers so a pending leave-close can be cancelled by the caller", () => {
    const onMouseLeave = vi.fn();
    const onMouseEnter = vi.fn();
    renderPanel({ panelProps: { onMouseEnter, onMouseLeave } });

    fireEvent.mouseLeave(screen.getByLabelText("Library"));
    fireEvent.mouseEnter(screen.getByLabelText("Library"));

    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });

  it("sits at the popover z-tier (200)", () => {
    renderPanel();
    expect(screen.getByLabelText("Library").className).toContain("z-[200]");
  });
});
