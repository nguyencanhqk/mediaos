/**
 * `StatusPill` — chip trạng thái chuẩn (UI-07 §13.7, S15-UI-SHELL-1).
 *
 * Hợp đồng cần neo: **tone ra đúng lớp màu của `Badge`** (một trạng thái ⇒ một màu ở mọi màn) và
 * **chấm màu là kênh thông tin THỨ HAI** — màu không được là kênh duy nhất (WCAG 1.4.1).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./status-pill";

describe("StatusPill", () => {
  it("render nhãn đã dịch (component KHÔNG tự gọi i18n)", () => {
    render(<StatusPill label="Đã duyệt" tone="success" />);
    expect(screen.getByText("Đã duyệt")).toBeInTheDocument();
  });

  it("tone ra đúng lớp màu của Badge — hai tone khác nhau KHÔNG cùng class", () => {
    const { container: ok } = render(<StatusPill label="Đã duyệt" tone="success" />);
    const { container: bad } = render(<StatusPill label="Từ chối" tone="danger" />);
    const okClass = ok.querySelector('[data-slot="status-pill"]')!.className;
    const badClass = bad.querySelector('[data-slot="status-pill"]')!.className;

    expect(okClass).toContain("bg-success-muted");
    expect(badClass).toContain("bg-danger-muted");
    expect(okClass).not.toBe(badClass);
  });

  it("mặc định tone = muted (trạng thái lạ không được tô như trạng thái tốt)", () => {
    const { container } = render(<StatusPill label="Không rõ" />);
    expect(container.querySelector('[data-slot="status-pill"]')!.className).toContain("bg-muted");
  });

  it("có chấm màu kèm nhãn — màu KHÔNG phải kênh thông tin duy nhất", () => {
    const { container } = render(<StatusPill label="Chờ duyệt" tone="warning" />);
    const dot = container.querySelector('[data-slot="status-pill"] span[aria-hidden]');
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-warning");
  });

  it("hideDot bỏ chấm (ô bảng hẹp) nhưng GIỮ nhãn", () => {
    const { container } = render(<StatusPill label="Nháp" hideDot />);
    expect(container.querySelector('[data-slot="status-pill"] span[aria-hidden]')).toBeNull();
    expect(screen.getByText("Nháp")).toBeInTheDocument();
  });
});
