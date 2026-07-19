import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingProvider, useOnboarding } from "../OnboardingProvider";
import { PREF_DEFAULTS } from "../../../hooks/useUserPreferences";

function BootGateHarness() {
  const [booting, setBooting] = useState(true);
  return (
    <OnboardingProvider>
      {booting && <div role="status" aria-label="Loading Lynceus" />}
      <button type="button" onClick={() => setBooting(false)}>
        Finish boot
      </button>
    </OnboardingProvider>
  );
}

function ReplayButton() {
  const { restart } = useOnboarding();
  return (
    <button type="button" onClick={(event) => restart(event.currentTarget)}>
      Replay tutorial
    </button>
  );
}

function renderProvider(child: React.ReactNode = <div>Application</div>) {
  return render(<OnboardingProvider>{child}</OnboardingProvider>);
}

describe("OnboardingProvider", () => {
  beforeEach(() => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation(
      (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
  });

  it("waits until the boot splash has actually unmounted", async () => {
    render(<BootGateHarness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish boot" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Bring in your library")).toBeInTheDocument();
  });

  it("auto-opens version 1 once and persists Skip", async () => {
    renderProvider();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      JSON.parse(localStorage.getItem("imageBrowserPrefs") as string)
        .onboardingVersionSeen,
    ).toBe(1);
  });

  it("does not auto-open after completion", async () => {
    localStorage.setItem(
      "imageBrowserPrefs",
      JSON.stringify({ ...PREF_DEFAULTS, onboardingVersionSeen: 1 }),
    );
    renderProvider();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("replays from scene 1 without lowering persistence and restores focus", async () => {
    localStorage.setItem(
      "imageBrowserPrefs",
      JSON.stringify({ ...PREF_DEFAULTS, onboardingVersionSeen: 1 }),
    );
    renderProvider(<ReplayButton />);
    const trigger = screen.getByRole("button", { name: "Replay tutorial" });

    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Bring in your library")).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("imageBrowserPrefs") as string)
        .onboardingVersionSeen,
    ).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(
      JSON.parse(localStorage.getItem("imageBrowserPrefs") as string)
        .onboardingVersionSeen,
    ).toBe(1);
  });

  it("keeps navigation bounded and Finish persists completion", async () => {
    renderProvider();
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByText("Turn references into practice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      JSON.parse(localStorage.getItem("imageBrowserPrefs") as string)
        .onboardingVersionSeen,
    ).toBe(1);
  });

  it("treats Escape as Skip", async () => {
    renderProvider();
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
