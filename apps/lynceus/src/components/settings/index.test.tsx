import { act, fireEvent, render, screen } from "@testing-library/react";
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

import { SettingsDrawer } from "./index";

describe("SettingsDrawer onboarding replay", () => {
  beforeEach(() => {
    restart.mockReset();
  });

  it("places Restart onboarding immediately above Reset all preferences", () => {
    const { container } = render(<SettingsDrawer open onClose={vi.fn()} />);
    const text = container.textContent ?? "";

    expect(text.indexOf("Library index")).toBeLessThan(
      text.indexOf("Restart onboarding"),
    );
    expect(text.indexOf("Restart onboarding")).toBeLessThan(
      text.indexOf("Reset all preferences"),
    );
  });

  it("starts replay with its focus trigger and leaves the drawer open", () => {
    // The drawer must NOT close on replay: the overlay covers it and the
    // inert app wrapper disables it, but the Restart button has to stay
    // MOUNTED so the provider's replay-close path can restore focus to a
    // connected element. Closing here put the trigger on a one-way
    // unmount — an integration probe showed focus silently dropping to
    // <body> (fast skip) or the gear icon (any realistic timing).
    const onClose = vi.fn();
    render(<SettingsDrawer open onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Restart onboarding" });

    act(() => fireEvent.click(trigger));

    expect(restart).toHaveBeenCalledWith(trigger);
    expect(onClose).not.toHaveBeenCalled();
  });
});
