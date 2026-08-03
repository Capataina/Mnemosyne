import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const restart = vi.fn();

vi.mock("../../features/onboarding", () => ({
  useOnboarding: () => ({ restart }),
}));
vi.mock("./ThemeSection", () => ({ ThemeSection: () => <div>Theme</div> }));
vi.mock("./DisplaySection", () => ({ DisplaySection: () => <div>Display</div> }));
vi.mock("./SearchSection", () => ({ SearchSection: () => <div>Search</div> }));
vi.mock("./FoldersSection", () => ({ FoldersSection: () => <div>Folders</div> }));
vi.mock("./EncoderSection", () => ({ EncoderSection: () => <div>Encoders</div> }));
vi.mock("./StatsSection", () => ({ StatsSection: () => <div>Library index</div> }));
vi.mock("./ResetSection", () => ({
  ResetSection: () => <button type="button">Reset all preferences</button>,
}));

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { SettingsDrawer } from "./index";

/** A real, focusable, document-attached trigger — so "focus returns to the
 * trigger on close" assertions have somewhere real to land. */
function makeTriggerRef() {
  const ref = createRef<HTMLButtonElement>();
  const trigger = document.createElement("button");
  trigger.textContent = "settings trigger";
  document.body.appendChild(trigger);
  (ref as { current: HTMLButtonElement | null }).current = trigger;
  return { ref, trigger };
}

function renderPanel(overrides: Partial<Parameters<typeof SettingsDrawer>[0]> = {}) {
  const onClose = vi.fn();
  const { ref: triggerRef, trigger } = makeTriggerRef();

  const utils = render(
    <SettingsDrawer
      open
      pinned
      onClose={onClose}
      panelProps={{ onMouseEnter: vi.fn(), onMouseLeave: vi.fn() }}
      triggerRef={triggerRef}
      {...overrides}
    />,
  );
  return { ...utils, onClose, triggerRef, trigger };
}

describe("SettingsDrawer onboarding replay", () => {
  beforeEach(() => {
    restart.mockReset();
  });

  it("places Restart onboarding immediately above Reset all preferences", () => {
    const { container } = renderPanel();
    const text = container.textContent ?? "";

    expect(text.indexOf("Library index")).toBeLessThan(
      text.indexOf("Restart onboarding"),
    );
    expect(text.indexOf("Restart onboarding")).toBeLessThan(
      text.indexOf("Reset all preferences"),
    );
  });

  it("starts replay with its focus trigger and leaves the panel open", () => {
    // The panel must NOT close on replay: the overlay covers it and the
    // inert app wrapper disables it, but the Restart button has to stay
    // MOUNTED so the provider's replay-close path can restore focus to a
    // connected element. Closing here put the trigger on a one-way
    // unmount — an integration probe showed focus silently dropping to
    // <body> (fast skip) or the gear icon (any realistic timing).
    const { onClose } = renderPanel();
    const trigger = screen.getByRole("button", { name: "Restart onboarding" });

    act(() => fireEvent.click(trigger));

    expect(restart).toHaveBeenCalledWith(trigger);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SettingsDrawer bubble interaction contract", () => {
  beforeEach(() => {
    restart.mockReset();
  });

  it("renders nothing when not open", () => {
    renderPanel({ open: false, pinned: false });
    expect(screen.queryByText("Theme")).not.toBeInTheDocument();
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
    fireEvent.pointerDown(screen.getByText("Theme"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the panel when pinned", () => {
    renderPanel({ pinned: true });
    expect(screen.getByLabelText("Settings")).toHaveFocus();
  });

  it("returns focus to the trigger once pinned goes false", () => {
    const { rerender, triggerRef, onClose } = renderPanel({ pinned: true });

    rerender(
      <SettingsDrawer
        open={false}
        pinned={false}
        onClose={onClose}
        panelProps={{ onMouseEnter: vi.fn(), onMouseLeave: vi.fn() }}
        triggerRef={triggerRef}
      />,
    );

    expect(triggerRef.current).toHaveFocus();
  });

  it("does not steal focus for a hover-only open (pinned=false)", () => {
    renderPanel({ pinned: false, open: true });
    expect(screen.getByLabelText("Settings")).not.toHaveFocus();
  });

  it("forwards panel hover handlers so a pending leave-close can be cancelled by the caller", () => {
    const onMouseLeave = vi.fn();
    const onMouseEnter = vi.fn();
    renderPanel({ panelProps: { onMouseEnter, onMouseLeave } });

    fireEvent.mouseLeave(screen.getByLabelText("Settings"));
    fireEvent.mouseEnter(screen.getByLabelText("Settings"));

    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });

  it("sits at the popover z-tier (200), below a modal dialog opened over it (the folder-remove/tag-delete confirm case)", () => {
    renderPanel();
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Remove folder?</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const panel = screen.getByLabelText("Settings");
    const dialogContent = screen.getByRole("dialog");

    // The z-ladder's authority is the comment in ui/dialog.tsx: dialogs at
    // 250 must render above every other surface, which is what the
    // folder-delete no-op bug (244b87a) broke. Reading the ACTUAL rendered
    // classes off both primitives (rather than duplicating the numbers
    // here) means this test breaks the moment either side of the ladder
    // drifts, instead of silently passing against stale expectations.
    const panelZ = Number(panel.className.match(/z-\[(\d+)\]/)?.[1]);
    const dialogZ = Number(dialogContent.className.match(/z-\[(\d+)\]/)?.[1]);

    expect(panelZ).toBe(200);
    expect(dialogZ).toBe(250);
    expect(dialogZ).toBeGreaterThan(panelZ);
  });
});
