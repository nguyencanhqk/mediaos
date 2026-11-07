// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useQuickCreateHotkey } from "./use-quick-create-hotkey";

function press(init: KeyboardEventInit, target: Element = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const CHORD = { altKey: true, shiftKey: true, code: "KeyN", key: "N" } as const;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useQuickCreateHotkey — Alt+Shift+N", () => {
  it("mở khi đúng tổ hợp và chặn mặc định của trình duyệt", () => {
    const onTrigger = vi.fn();
    renderHook(() => useQuickCreateHotkey(true, onTrigger));
    const event = press(CHORD);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("nhận cả khi macOS trả key='Dead' (so event.code)", () => {
    const onTrigger = vi.fn();
    renderHook(() => useQuickCreateHotkey(true, onTrigger));
    press({ ...CHORD, key: "Dead" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["phím n trơn (WCAG 2.1.4)", { code: "KeyN", key: "n" }],
    ["Alt+N không Shift", { altKey: true, code: "KeyN", key: "n" }],
    ["Shift+N không Alt", { shiftKey: true, code: "KeyN", key: "N" }],
    ["AltGr (Ctrl+Alt+Shift+N)", { ...CHORD, ctrlKey: true }],
    ["Meta+Alt+Shift+N", { ...CHORD, metaKey: true }],
    ["Ctrl+K của AppSwitcher", { ctrlKey: true, code: "KeyK", key: "k" }],
    ["giữ phím (repeat)", { ...CHORD, repeat: true }],
  ])("không làm gì với %s", (_name, init) => {
    const onTrigger = vi.fn();
    renderHook(() => useQuickCreateHotkey(true, onTrigger));
    const event = press(init);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(["input", "textarea", "select"])("bỏ qua khi focus ở <%s> và không nuốt phím", (tag) => {
    const onTrigger = vi.fn();
    renderHook(() => useQuickCreateHotkey(true, onTrigger));
    const el = document.body.appendChild(document.createElement(tag));
    const event = press(CHORD, el);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("bỏ qua trong vùng contenteditable (kể cả phần tử con)", () => {
    const onTrigger = vi.fn();
    renderHook(() => useQuickCreateHotkey(true, onTrigger));
    const host = document.body.appendChild(document.createElement("div"));
    host.setAttribute("contenteditable", "true");
    const child = host.appendChild(document.createElement("span"));
    press(CHORD, child);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("bỏ qua khi đang trong hộp thoại khác (không chồng modal)", () => {
    const onTrigger = vi.fn();
    renderHook(() => useQuickCreateHotkey(true, onTrigger));
    const dlg = document.body.appendChild(document.createElement("div"));
    dlg.setAttribute("role", "dialog");
    const btn = dlg.appendChild(document.createElement("button"));
    press(CHORD, btn);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("enabled=false (thiếu quyền) ⇒ không gắn listener", () => {
    const onTrigger = vi.fn();
    renderHook(() => useQuickCreateHotkey(false, onTrigger));
    const event = press(CHORD);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("gỡ listener khi unmount", () => {
    const onTrigger = vi.fn();
    const { unmount } = renderHook(() => useQuickCreateHotkey(true, onTrigger));
    unmount();
    press(CHORD);
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
