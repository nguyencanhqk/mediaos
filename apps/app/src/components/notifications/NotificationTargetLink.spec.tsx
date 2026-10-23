// @vitest-environment jsdom
/**
 * NotificationTargetLink tests (S4-FE-NOTI-1) — deep link AN TOÀN, KHÔNG bỏ route guard.
 * Phủ: target_url nội bộ ("/...") → render button, click → onBeforeNavigate() + navigate({to}) ĐÚNG 1 lần.
 * target_url null/rỗng/tuyệt đối/protocol-relative → KHÔNG render button (render span trần, không click được).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import { NotificationTargetLink, isSafeInternalTarget } from "./NotificationTargetLink";

beforeEach(() => {
  mockNavigate.mockReset();
});

describe("isSafeInternalTarget — whitelist đường dẫn nội bộ", () => {
  it.each([
    ["/leave/me/requests/req-1", true],
    ["/hr/employees/emp-1", true],
    ["/", true],
    [null, false],
    [undefined, false],
    ["", false],
    ["http://evil.example.com/phish", false],
    ["https://evil.example.com", false],
    ["//evil.example.com", false],
    ["javascript:alert(1)", false],
  ])("isSafeInternalTarget(%s) → %s", (input, expected) => {
    expect(isSafeInternalTarget(input as string | null | undefined)).toBe(expected);
  });
});

describe("NotificationTargetLink — render", () => {
  it("target_url nội bộ → render <button>, click → onBeforeNavigate() rồi navigate({to: target_url})", () => {
    const onBeforeNavigate = vi.fn();
    render(
      <NotificationTargetLink
        targetUrl="/leave/me/requests/req-1"
        onBeforeNavigate={onBeforeNavigate}
      >
        Xem đơn nghỉ
      </NotificationTargetLink>,
    );
    const button = screen.getByRole("button", { name: "Xem đơn nghỉ" });
    fireEvent.click(button);
    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/leave/me/requests/req-1" }),
    );
  });

  it("target_url null → KHÔNG render button (render span, click không điều hướng)", () => {
    render(<NotificationTargetLink targetUrl={null}>Không có liên kết</NotificationTargetLink>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Không có liên kết")).toBeTruthy();
  });

  it("target_url tuyệt đối (http://) → KHÔNG render button (chặn open-redirect)", () => {
    render(
      <NotificationTargetLink targetUrl="http://evil.example.com/phish">
        Nội dung
      </NotificationTargetLink>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("target_url protocol-relative (//host) → KHÔNG render button", () => {
    render(
      <NotificationTargetLink targetUrl="//evil.example.com">Nội dung</NotificationTargetLink>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// S20-TASK-DRAWER-1 — đích `/tasks/<uuid>` mở drawer việc TẠI CHỖ (thêm `?task=` vào URL hiện tại),
// không rời trang đang đứng (vd /goals/G ⇒ /goals/G?task=T).
describe("NotificationTargetLink — đích việc mở drawer tại chỗ", () => {
  const TASK_UUID = "0b9f6a4e-2c1d-4e8f-9a7b-3c5d6e7f8a9b";

  it("/tasks/<uuid> ⇒ onBeforeNavigate rồi PUSH ?task=<uuid> trên đường hiện tại, giữ tham số khác", () => {
    const onBeforeNavigate = vi.fn();
    render(
      <NotificationTargetLink targetUrl={`/tasks/${TASK_UUID}`} onBeforeNavigate={onBeforeNavigate}>
        Việc được giao
      </NotificationTargetLink>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Việc được giao" }));

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const arg = mockNavigate.mock.calls[0]?.[0] as {
      to: string;
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(arg.to).toBe(".");
    expect(arg.replace).not.toBe(true);
    expect(arg.search({ tab: "tasks" })).toEqual({ tab: "tasks", task: TASK_UUID });
  });

  it.each([["/tasks/my-tasks"], ["/tasks/overdue"], ["/tasks/not-a-uuid"], ["/tasks/projects/p1"]])(
    "%s ⇒ điều hướng như cũ (không phải đích một việc)",
    (target) => {
      render(<NotificationTargetLink targetUrl={target}>Mở</NotificationTargetLink>);
      fireEvent.click(screen.getByRole("button", { name: "Mở" }));
      expect(mockNavigate).toHaveBeenCalledWith({ to: target });
    },
  );
});

// S20-NOTI-LISTNAV-1 — trang Thông báo: đích rỗng/không an toàn ⇒ caller tự lo (trang chi tiết như cũ).
// Kiểm an toàn VẪN chỉ nằm ở `isSafeInternalTarget` — `onUnsafeTarget` chỉ nhận lượt bấm khi đích bị loại.
describe("NotificationTargetLink — onUnsafeTarget (đích bị loại ⇒ đường lui của caller)", () => {
  it.each([
    [null],
    [""],
    ["https://evil.example.com/phish"],
    ["//evil.example.com"],
    ["javascript:alert(1)"],
  ])(
    "target_url %s ⇒ button gọi onUnsafeTarget, KHÔNG navigate, KHÔNG onBeforeNavigate",
    (target) => {
      const onUnsafeTarget = vi.fn();
      const onBeforeNavigate = vi.fn();
      render(
        <NotificationTargetLink
          targetUrl={target}
          onBeforeNavigate={onBeforeNavigate}
          onUnsafeTarget={onUnsafeTarget}
        >
          Thông báo hệ thống
        </NotificationTargetLink>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Thông báo hệ thống" }));
      expect(onUnsafeTarget).toHaveBeenCalledTimes(1);
      expect(onBeforeNavigate).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );

  it("đích an toàn ⇒ onUnsafeTarget KHÔNG được gọi, điều hướng như cũ", () => {
    const onUnsafeTarget = vi.fn();
    render(
      <NotificationTargetLink targetUrl="/hr/employees/emp-1" onUnsafeTarget={onUnsafeTarget}>
        Hồ sơ
      </NotificationTargetLink>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hồ sơ" }));
    expect(onUnsafeTarget).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/hr/employees/emp-1" });
  });
});
