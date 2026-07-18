import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FeedItem } from "../types";
import { MasonryItem } from "./MasonryItem";

vi.mock("../hooks/useAdaptiveThumbnail", () => ({
  useAdaptiveThumbnail: () => "thumb://tile",
}));

const item: FeedItem = {
  id: 7,
  name: "tile-7",
  width: 400,
  height: 240,
  hasThumbnail: true,
  thumbnailUrl: "thumb://tile",
};

function renderItem(resizeEnabled: boolean) {
  return render(
    <MasonryItem
      item={item}
      onClick={vi.fn()}
      reorderEnabled={resizeEnabled}
      resizeEnabled={resizeEnabled}
      onResizeHandlePointerDown={vi.fn()}
    />,
  );
}

describe("MasonryItem resize availability", () => {
  it("hides every neighbour resize grip when the surrounding view disables gestures", () => {
    renderItem(false);
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
  });

  it("renders all four grips in the ordinary reorderable feed", () => {
    renderItem(true);
    expect(screen.getAllByRole("slider")).toHaveLength(4);
  });
});
