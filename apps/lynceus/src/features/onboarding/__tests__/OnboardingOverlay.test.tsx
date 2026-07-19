import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingProvider } from "../OnboardingProvider";
import { sceneRegistry } from "../sceneRegistry";
import { PREF_DEFAULTS } from "../../../hooks/useUserPreferences";

const motionPreference = vi.hoisted(() => ({ reduced: false }));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => motionPreference.reduced,
  };
});

describe("OnboardingOverlay", () => {
  beforeEach(() => {
    motionPreference.reduced = false;
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

  it("makes the app inert, keeps the scene decorative, and traps focus", async () => {
    const { container } = render(
      <OnboardingProvider>
        <button type="button">Application control</button>
      </OnboardingProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    const app = container.querySelector("[data-onboarding-app-content]") as HTMLElement;
    const scene = container.querySelector("[data-onboarding-scene]") as HTMLElement;
    const next = screen.getByRole("button", { name: "Next" });
    const skip = screen.getByRole("button", { name: "Skip" });

    expect(dialog.className).toContain("z-[240]");
    expect(app).toHaveAttribute("inert");
    expect(app).toHaveAttribute("aria-hidden", "true");
    expect(scene).toHaveAttribute("aria-hidden", "true");
    expect(scene.style.pointerEvents).toBe("none");

    await waitFor(() => expect(document.activeElement).toBe(next));
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(skip);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next);
  });

  it("renders a motion-free filmstrip for OS reduced motion", async () => {
    motionPreference.reduced = true;
    const { container } = render(
      <OnboardingProvider>
        <div>Application</div>
      </OnboardingProvider>,
    );
    await screen.findByRole("dialog");
    const filmstrip = container.querySelector(
      "[data-reduced-motion-filmstrip]",
    ) as HTMLElement;

    expect(filmstrip).toBeInTheDocument();
    expect(container.querySelector("[data-onboarding-cursor]")).toBeNull();
    for (const element of filmstrip.querySelectorAll<HTMLElement>("*")) {
      expect(element.style.animationName).toBe("");
      expect(element.style.transitionDuration).toBe("");
    }
  });

  it("renders the same static filmstrip when app animations are off", async () => {
    localStorage.setItem(
      "imageBrowserPrefs",
      JSON.stringify({
        ...PREF_DEFAULTS,
        animationLevel: "off",
        onboardingVersionSeen: 0,
      }),
    );
    const { container } = render(
      <OnboardingProvider>
        <div>Application</div>
      </OnboardingProvider>,
    );
    await screen.findByRole("dialog");

    expect(
      container.querySelector("[data-reduced-motion-filmstrip]"),
    ).toBeInTheDocument();
    for (const [index, scene] of sceneRegistry.entries()) {
      expect(screen.getByText(scene.title)).toBeInTheDocument();
      expect(
        container.querySelector("[data-reduced-motion-filmstrip]"),
      ).toBeInTheDocument();
      if (index < sceneRegistry.length - 1) {
        fireEvent.click(screen.getByRole("button", { name: "Next" }));
      }
    }
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("keeps functional choreography but removes click halos in subtle mode", async () => {
    localStorage.setItem(
      "imageBrowserPrefs",
      JSON.stringify({
        ...PREF_DEFAULTS,
        animationLevel: "subtle",
        onboardingVersionSeen: 0,
      }),
    );
    const { container } = render(
      <OnboardingProvider>
        <div>Application</div>
      </OnboardingProvider>,
    );
    await screen.findByRole("dialog");

    expect(container.querySelector("[data-onboarding-cursor]")).toBeInTheDocument();
    expect(container.querySelector("[data-onboarding-click-halo]")).toBeNull();
    expect(container.querySelector("[data-reduced-motion-filmstrip]")).toBeNull();
  });
});
