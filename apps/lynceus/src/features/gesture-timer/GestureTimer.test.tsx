import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GestureTimer } from "./GestureTimer";
import type { GestureTimerImage } from "./types";

const startingImage: GestureTimerImage = {
  id: 1,
  url: "start.jpg",
  name: "Starting reference",
};

const candidates: GestureTimerImage[] = [
  { id: 2, url: "second.jpg", name: "Second reference" },
  { id: 3, url: "third.jpg", name: "Third reference" },
];

describe("GestureTimer inline setup", () => {
  it("starts the fullscreen timer directly without an intermediate dialog", () => {
    const onOpenChange = vi.fn();
    render(
      <GestureTimer
        startingImage={startingImage}
        candidateImages={candidates}
        onOpenChange={onOpenChange}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(
      screen.getByRole("dialog", { name: "Gesture drawing timer" }),
    ).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("keeps start disabled while the similar-image pool is empty", () => {
    render(
      <GestureTimer
        startingImage={startingImage}
        candidateImages={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByText("No candidates")).toBeInTheDocument();
  });
});
