import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * Regression test for the tag-delete bug.
 *
 * The trash button first used a modal confirm Dialog. That never worked:
 * this dropdown is a `modal` Radix Popover, and a modal popover blocks
 * pointer events to everything outside its own content — including the
 * App-level confirm Dialog — so the confirm button's click was swallowed and
 * `onDeleteTag` never fired (two rounds of "delete does nothing"). The fix
 * removes the second modal layer entirely: an inline two-click arm-then-
 * confirm on the trash button (the app's reset-control pattern). First click
 * arms; a second click on the armed "Delete?" control deletes. This guards
 * that the first click does NOT delete and the second one does.
 */

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDropdown(onDeleteTag: (id: number) => void) {
  const setOpen = vi.fn();
  render(
    <TagDropdown
      tags={[{ id: 7, name: "landscape", color: "#3B82F6" }]}
      open={true}
      setOpen={setOpen}
      selected={[]}
      setSelected={vi.fn()}
      placeholder="Add tags"
      instruction="Pick tags"
      onCreateTag={vi.fn()}
      onDeleteTag={onDeleteTag}
      imageId={1}
      onAssignTag={vi.fn()}
      onRemoveTag={vi.fn()}
    />,
  );
  return { setOpen };
}

import { TagDropdown } from "./TagDropdown";

it("arms on the first trash click and does not delete yet", () => {
  const onDeleteTag = vi.fn();
  renderDropdown(onDeleteTag);

  fireEvent.click(
    screen.getByRole("button", { name: /^delete tag landscape/i }),
  );

  // Armed, not deleted — the confirm control is now present.
  expect(onDeleteTag).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: /confirm delete tag landscape/i }),
  ).toBeTruthy();
});

it("deletes on the second click of the armed control", () => {
  const onDeleteTag = vi.fn();
  const { setOpen } = renderDropdown(onDeleteTag);

  fireEvent.click(
    screen.getByRole("button", { name: /^delete tag landscape/i }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /confirm delete tag landscape/i }),
  );

  expect(onDeleteTag).toHaveBeenCalledWith(7);
  expect(setOpen).toHaveBeenCalledWith(false);
});
