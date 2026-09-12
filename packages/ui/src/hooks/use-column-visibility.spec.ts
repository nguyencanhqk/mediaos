/**
 * `useColumnVisibility` — bộ cột đang hiện, lưu per-user + per-table (UI-07 §12.3, S15-UI-SHELL-1).
 *
 * Ca quan trọng nhất ở đây KHÔNG phải "bấm ⚙ thì ẩn cột": đó là **`localStorage` CŨ không được ẩn
 * mất cột `locked`**. Bộ cột đổi theo thời gian (WO sau thêm cột Actions, ghim nó lại), còn bản lưu
 * trong máy người dùng thì không đổi theo — nếu luật `locked` chỉ ép lúc BẤM, một khoá cũ sẽ âm thầm
 * giấu cột định danh của bảng và không có gì báo.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useColumnVisibility, type ColumnOption } from "./use-column-visibility";

const KEY = "payroll.periods";
const STORAGE_KEY = `mediaos.table.hiddenColumns:${KEY}`;

const OPTIONS: ColumnOption[] = [
  { id: "month", label: "Kỳ", locked: true },
  { id: "status", label: "Trạng thái" },
  { id: "payDate", label: "Ngày trả" },
  { id: "note", label: "Ghi chú", defaultHidden: true },
];

beforeEach(() => {
  window.localStorage.clear();
});

describe("useColumnVisibility", () => {
  it("lần đầu: ẩn đúng cột defaultHidden, isDefault = true", () => {
    const { result } = renderHook(() => useColumnVisibility(KEY, OPTIONS));
    expect(result.current.hiddenIds).toEqual(["note"]);
    expect(result.current.visibility).toEqual({ note: false });
    expect(result.current.isDefault).toBe(true);
  });

  it("toggle ẩn/hiện một cột và ghi localStorage", () => {
    const { result } = renderHook(() => useColumnVisibility(KEY, OPTIONS));

    act(() => result.current.toggle("payDate"));
    expect(result.current.visibility).toEqual({ note: false, payDate: false });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual(["note", "payDate"]);

    act(() => result.current.toggle("note"));
    expect(result.current.visibility).toEqual({ payDate: false });
    expect(result.current.isDefault).toBe(false);
  });

  it("ẩn HẾT cột tắt được là lựa chọn hợp lệ — KHÔNG bị hiểu thành «chưa đặt» rồi rơi về mặc định", () => {
    const { result } = renderHook(() => useColumnVisibility(KEY, OPTIONS));
    act(() => result.current.toggle("note")); // bỏ mặc định
    act(() => result.current.toggle("status"));
    act(() => result.current.toggle("payDate"));
    act(() => result.current.toggle("note"));
    expect(result.current.hiddenIds).toEqual(expect.arrayContaining(["status", "payDate", "note"]));

    // Rồi hiện lại hết ⇒ mảng RỖNG phải được giữ, không quay về ["note"] của defaultHidden.
    act(() => result.current.toggle("status"));
    act(() => result.current.toggle("payDate"));
    act(() => result.current.toggle("note"));
    expect(result.current.hiddenIds).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it("toggle cột locked KHÔNG có tác dụng", () => {
    const { result } = renderHook(() => useColumnVisibility(KEY, OPTIONS));
    act(() => result.current.toggle("month"));
    expect(result.current.hiddenIds).not.toContain("month");
    expect(result.current.visibility.month).toBeUndefined();
  });

  it("localStorage CŨ ghi id nay đã locked ⇒ BỎ QUA, cột định danh vẫn hiện", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["month", "payDate"]));
    const { result } = renderHook(() => useColumnVisibility(KEY, OPTIONS));
    expect(result.current.hiddenIds).toEqual(["payDate"]);
    expect(result.current.visibility).toEqual({ payDate: false });
  });

  it("localStorage ghi id không còn trong bảng ⇒ lọc bỏ (không sinh khoá rác cho DataTable)", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["daCoTuKiepTruoc", "status"]));
    const { result } = renderHook(() => useColumnVisibility(KEY, OPTIONS));
    expect(result.current.visibility).toEqual({ status: false });
  });

  it("localStorage hỏng (JSON rác) ⇒ rơi về bộ mặc định, KHÔNG ném", () => {
    window.localStorage.setItem(STORAGE_KEY, "{khong-phai-json");
    const { result } = renderHook(() => useColumnVisibility(KEY, OPTIONS));
    expect(result.current.hiddenIds).toEqual(["note"]);
  });

  it("reset xoá lựa chọn, trả về bộ mặc định", () => {
    const { result } = renderHook(() => useColumnVisibility(KEY, OPTIONS));
    act(() => result.current.toggle("status"));
    expect(result.current.isDefault).toBe(false);

    act(() => result.current.reset());
    expect(result.current.hiddenIds).toEqual(["note"]);
    expect(result.current.isDefault).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("null");
  });

  it("bộ cột TẠM hẹp lại: bấm cột khác KHÔNG xoá lựa chọn của cột đang vắng khỏi options", () => {
    // Cột tiền bị bỏ khỏi picker khi trang rỗng (fail-closed masking ở màn PAYROLL). Trong lúc đó
    // người dùng bấm một cột khác — lựa chọn của cột tiền phải còn nguyên khi nó quay lại.
    const withMoney: ColumnOption[] = [...OPTIONS, { id: "baseSalary", label: "Lương cơ bản" }];
    const full = renderHook(() => useColumnVisibility(KEY, withMoney));
    act(() => full.result.current.toggle("baseSalary"));
    expect(full.result.current.hiddenIds).toContain("baseSalary");
    full.unmount();

    // options hẹp lại (KHÔNG còn baseSalary) rồi bấm một cột khác
    const narrow = renderHook(() => useColumnVisibility(KEY, OPTIONS));
    expect(narrow.result.current.hiddenIds).not.toContain("baseSalary"); // lọc lúc ĐỌC — đúng
    act(() => narrow.result.current.toggle("status"));
    narrow.unmount();

    // options đủ trở lại ⇒ lựa chọn cũ của cột tiền VẪN CÒN
    const back = renderHook(() => useColumnVisibility(KEY, withMoney));
    expect(back.result.current.hiddenIds).toEqual(expect.arrayContaining(["baseSalary", "status"]));
  });

  it("hai bảng khác tableKey không giẫm lên nhau", () => {
    const a = renderHook(() => useColumnVisibility("bang-a", OPTIONS));
    act(() => a.result.current.toggle("status"));

    const b = renderHook(() => useColumnVisibility("bang-b", OPTIONS));
    expect(b.result.current.hiddenIds).toEqual(["note"]);
  });
});
