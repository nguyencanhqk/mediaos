import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Popover } from "./popover";
import { Sheet } from "./sheet";

/**
 * S5-TASK-INLINE-1 — hai lỗi thật đã vá, khoá lại bằng test:
 *
 *  1. BỊ CẮT MẤT trong vùng cuộn: panel từng dùng `position: absolute` nên mọi tổ tiên
 *     `overflow-y-auto` đều xén nó theo chiều NGANG (CSS: một trục khác `visible` ⇒ trục kia thôi
 *     `visible`). Triệu chứng: picker chọn người trên dòng việc con trong drawer chi tiết bị cụt mép
 *     trái. Cách vá: portal ra `document.body` + toạ độ `fixed`.
 *
 *  2. MỘT ESC ĐÓNG CẢ HAI: popover và Sheet chứa nó cùng nghe Esc trên `document`, nên đang mở
 *     picker mà bấm Esc là mất luôn cả drawer. Cách vá: popover đánh dấu `data-floating-layer`,
 *     Sheet thấy dấu thì NHƯỜNG Esc.
 *
 * jsdom không tính layout (mọi getBoundingClientRect trả 0) nên KHÔNG test toạ độ cụ thể ở đây —
 * chỉ khoá phần kiểm chứng được: portal thoát khỏi cây cha, và thứ tự nhường Esc.
 */
function ScrollBox({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="scroll-box" className="overflow-y-auto">
      {children}
    </div>
  );
}

function ControlledPopover({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" onClick={() => setOpen((v) => !v)}>
          Mở
        </button>
      }
    >
      {children ?? <p>Nội dung popover</p>}
    </Popover>
  );
}

describe("Popover", () => {
  it("panel PORTAL ra document.body — không nằm trong vùng cuộn nên không bị xén", () => {
    render(
      <ScrollBox>
        <ControlledPopover />
      </ScrollBox>,
    );
    fireEvent.click(screen.getByText("Mở"));

    const panel = screen.getByRole("dialog");
    expect(panel).toBeInTheDocument();
    // Mấu chốt: panel KHÔNG còn là con của vùng cuộn (đó chính là thứ từng cắt cụt nó).
    expect(screen.getByTestId("scroll-box").contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
  });

  it("panel dùng position fixed (thoát mọi tổ tiên cắt)", () => {
    render(<ControlledPopover />);
    fireEvent.click(screen.getByText("Mở"));
    expect(screen.getByRole("dialog").style.position).toBe("fixed");
  });

  it("đánh dấu data-floating-layer để lớp bao ngoài biết mà nhường Esc", () => {
    render(<ControlledPopover />);
    fireEvent.click(screen.getByText("Mở"));
    expect(document.querySelector('[data-floating-layer="open"]')).not.toBeNull();
  });

  it("đóng thì gỡ sạch panel khỏi document (không để lại dấu floating-layer)", () => {
    render(<ControlledPopover />);
    fireEvent.click(screen.getByText("Mở"));
    fireEvent.click(screen.getByText("Mở"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector('[data-floating-layer="open"]')).toBeNull();
  });

  it("bấm TRONG panel không đóng (dù panel đã portal ra ngoài cây trigger)", () => {
    render(
      <ControlledPopover>
        <button type="button">Mục trong panel</button>
      </ControlledPopover>,
    );
    fireEvent.click(screen.getByText("Mở"));
    fireEvent.mouseDown(screen.getByText("Mục trong panel"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("bấm ra ngoài thì đóng", () => {
    render(<ControlledPopover />);
    fireEvent.click(screen.getByText("Mở"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Popover lồng trong Sheet — Esc", () => {
  function SheetWithPopover({ onClose }: { onClose: () => void }) {
    return (
      <Sheet open onClose={onClose} title="Chi tiết công việc">
        <ControlledPopover />
      </Sheet>
    );
  }

  it("Esc khi popover ĐANG MỞ chỉ đóng popover, GIỮ sheet", () => {
    const onClose = vi.fn();
    render(<SheetWithPopover onClose={onClose} />);
    fireEvent.click(screen.getByText("Mở"));
    expect(screen.getByRole("dialog", { name: "" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    // Sheet KHÔNG được đóng theo — đây chính là lỗi đã vá.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc khi popover đã đóng thì đóng sheet như thường", () => {
    const onClose = vi.fn();
    render(<SheetWithPopover onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
