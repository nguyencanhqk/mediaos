import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";

describe("Dialog — a11y wiring", () => {
  it("renders role=dialog with aria-modal and labelledby/describedby pointing at title/description", () => {
    render(
      <Dialog open onClose={vi.fn()} title="Tiêu đề" description="Mô tả ngắn">
        <p>Nội dung</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const labelledby = dialog.getAttribute("aria-labelledby");
    const describedby = dialog.getAttribute("aria-describedby");
    expect(labelledby).toBeTruthy();
    expect(describedby).toBeTruthy();
    // aria-labelledby/describedby phải trỏ tới đúng phần tử chứa title/description.
    expect(document.getElementById(labelledby!)).toHaveTextContent("Tiêu đề");
    expect(document.getElementById(describedby!)).toHaveTextContent("Mô tả ngắn");
  });

  it("omits aria-describedby when no description is provided", () => {
    render(
      <Dialog open onClose={vi.fn()} title="Chỉ có tiêu đề">
        <p>Nội dung</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
  });

  it("does not render anything when closed", () => {
    render(
      <Dialog open={false} onClose={vi.fn()} title="Ẩn">
        <p>Nội dung</p>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        <button>OK</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog — focus management", () => {
  it("moves focus to the first focusable element on open", () => {
    render(
      <Dialog open onClose={vi.fn()} title="T">
        <input aria-label="đầu tiên" />
        <button>sau</button>
      </Dialog>,
    );
    expect(screen.getByLabelText("đầu tiên")).toHaveFocus();
  });

  it("traps Tab: from the last focusable it wraps back to the first", () => {
    render(
      <Dialog open onClose={vi.fn()} title="T">
        <button>first</button>
        <button>last</button>
      </Dialog>,
    );
    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
  });

  it("traps Shift+Tab: from the first focusable it wraps to the last", () => {
    render(
      <Dialog open onClose={vi.fn()} title="T">
        <button>first</button>
        <button>last</button>
      </Dialog>,
    );
    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("returns focus to the trigger when closed", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Mở</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="T">
            <button>bên trong</button>
          </Dialog>
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Mở" });
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bên trong" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
