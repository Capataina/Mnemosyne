import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Regression test for the tag-delete ordering bug.
 *
 * The trash button used to call `setOpen(false)` BEFORE awaiting the
 * confirm dialog. Closing the modal popover in the same tick as the modal
 * confirm dialog opened raced two Radix layers: the popover's teardown
 * dispatched an event the dialog read as an outside-dismiss, so the confirm
 * auto-cancelled and `onDeleteTag` never fired.
 *
 * The fix awaits the confirm FIRST, then closes. We guard the invariant by
 * recording call order across the confirm, setOpen, and onDeleteTag spies:
 * confirm must resolve before the dropdown closes, and the delete must fire
 * after a confirmed choice. The pre-fix code would order setOpen before
 * confirm and (in the real app) never reach the delete.
 */

const order: string[] = [];
let confirmResult = true;

const confirmSpy = vi.fn(async () => {
  order.push("confirm");
  return confirmResult;
});

vi.mock("@/components/ui/confirm", () => ({
  useConfirm: () => confirmSpy,
}));

import { TagDropdown } from "./TagDropdown";

function renderDropdown(overrides?: {
  setOpen?: (open: boolean) => void;
  onDeleteTag?: (id: number) => void;
}) {
  const setOpen =
    overrides?.setOpen ??
    vi.fn(() => {
      order.push("setOpen");
    });
  const onDeleteTag =
    overrides?.onDeleteTag ??
    vi.fn(() => {
      order.push("delete");
    });

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

  return { setOpen, onDeleteTag };
}

beforeEach(() => {
  order.length = 0;
  confirmResult = true;
  confirmSpy.mockClear();
});

it("confirms before closing the dropdown, then deletes", async () => {
  const { setOpen, onDeleteTag } = renderDropdown();

  fireEvent.click(
    screen.getByRole("button", { name: /delete tag landscape/i }),
  );

  await waitFor(() => expect(onDeleteTag).toHaveBeenCalledWith(7));

  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(setOpen).toHaveBeenCalledWith(false);
  // The invariant the fix restores: confirm resolves first, then the
  // dropdown closes, then the delete fires.
  expect(order).toEqual(["confirm", "setOpen", "delete"]);
});

it("does not delete when the confirm is cancelled", async () => {
  confirmResult = false;
  const { setOpen, onDeleteTag } = renderDropdown();

  fireEvent.click(
    screen.getByRole("button", { name: /delete tag landscape/i }),
  );

  await waitFor(() => expect(setOpen).toHaveBeenCalledWith(false));

  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(onDeleteTag).not.toHaveBeenCalled();
});
