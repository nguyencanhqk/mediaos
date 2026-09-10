import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";

/**
 * S17-CHAT-UX2-FE-4 — hai luật của primitive này, cả hai đều hỏng IM LẶNG nếu vỡ:
 *
 *  1. **Đóng ⇒ UNMOUNT thân.** Ẩn bằng CSS thì `useEffect`/`useQuery` trong con vẫn chạy ⇒ vẫn gọi API
 *     cho mục người dùng chưa mở. Ca dưới đây đo bằng một `useEffect` đếm số lần mount, không đo bằng
 *     `toBeVisible()` — "không nhìn thấy" và "không chạy" là hai chuyện khác nhau.
 *  2. **Controlled.** `value` là nguồn sự thật duy nhất; primitive KHÔNG giữ state riêng, nên consumer
 *     đọc được "mục nào đang mở" để quyết định có gọi API hay không.
 */
function mounted(spy: () => void) {
  return function Probe(): React.ReactElement {
    React.useEffect(() => {
      spy();
    }, []);
    return <p>thân mục</p>;
  };
}

function Harness({
  initial = [],
  onMount,
}: {
  initial?: string[];
  onMount: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState<string[]>(initial);
  const Probe = mounted(onMount);
  return (
    <Accordion value={open} onValueChange={setOpen}>
      <AccordionItem value="media">
        <AccordionTrigger meta={<span>3</span>}>Ảnh / Video</AccordionTrigger>
        <AccordionContent>
          <Probe />
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="files">
        <AccordionTrigger>Tệp</AccordionTrigger>
        <AccordionContent>
          <p>danh sách tệp</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe("Accordion", () => {
  it("mục ĐÓNG không mount thân — không phải chỉ ẩn nó đi", () => {
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);

    expect(onMount).not.toHaveBeenCalled();
    expect(screen.queryByText("thân mục")).toBeNull();
    expect(screen.getByRole("button", { name: /Ảnh \/ Video/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("bấm trigger ⇒ mount thân MỘT lần và đánh dấu aria-expanded", () => {
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);

    fireEvent.click(screen.getByRole("button", { name: /Ảnh \/ Video/ }));

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(screen.getByText("thân mục")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ảnh \/ Video/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("NHIỀU mục mở cùng lúc; đóng mục này không đụng mục kia", () => {
    render(<Harness initial={["media"]} onMount={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Tệp" }));
    expect(screen.getByText("thân mục")).toBeTruthy();
    expect(screen.getByText("danh sách tệp")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Ảnh \/ Video/ }));
    expect(screen.queryByText("thân mục")).toBeNull();
    expect(screen.getByText("danh sách tệp")).toBeTruthy();
  });

  it("thân là region gắn nhãn bởi chính trigger (a11y: đọc được đang ở mục nào)", () => {
    render(<Harness initial={["files"]} onMount={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Tệp" });
    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-labelledby")).toBe(trigger.id);
    expect(trigger.getAttribute("aria-controls")).toBe(region.id);
  });

  /**
   * Guard của `AccordionTrigger`/`AccordionContent` là MỘT nhánh RIÊNG (`useAccordionItemContext`),
   * không phải nhánh của `AccordionItem` ở ca dưới. Thiếu ca này thì xoá hẳn dòng `throw` đó vẫn
   * xanh cả suite — và lần đầu ai đó đặt nhầm chỗ hai component này sẽ nhận một khối render CÂM
   * thay vì một lỗi nói rõ sai ở đâu.
   */
  it("AccordionTrigger/AccordionContent dùng ngoài <AccordionItem> ⇒ NÉM, nêu ĐÚNG tên component", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<AccordionTrigger>x</AccordionTrigger>)).toThrow(
      "<AccordionTrigger> phải nằm trong <AccordionItem>",
    );
    expect(() => render(<AccordionContent>x</AccordionContent>)).toThrow(
      "<AccordionContent> phải nằm trong <AccordionItem>",
    );
    quiet.mockRestore();
  });

  it("dùng ngoài <Accordion>/<AccordionItem> ⇒ NÉM ngay, không render câm", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <AccordionItem value="x">
          <AccordionTrigger>x</AccordionTrigger>
        </AccordionItem>,
      ),
    ).toThrow(/<AccordionItem> phải nằm trong <Accordion>/);
    quiet.mockRestore();
  });
});
