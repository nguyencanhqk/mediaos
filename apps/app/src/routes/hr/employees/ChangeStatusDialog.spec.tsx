/**
 * ChangeStatusDialog — S10-HR-STATUSUI-1 (HR-FUNC-006).
 *
 * Kiểm ĐÚNG những chỗ FE có thể nói dối server:
 *  - lọc lựa chọn theo FSM cho CẢ 4 trạng thái nguồn (sai ⇒ người dùng bấm rồi ăn 422);
 *  - status LẠ ⇒ 0 lựa chọn (read DTO khai z.string(), không phải enum — fail-closed, không nổ);
 *  - endDate CHỈ gửi khi sang exit-status, và CHỈ hiện ô nhập khi đó (server 400 cả hai chiều);
 *  - checkbox khoá tài khoản ẩn ở transition không-exit VÀ ẩn trên hồ sơ của CHÍNH người bấm
 *    (BE chặn tự khoá ở hr-write.service.ts:510 — UI hứa cái server bỏ qua là nói dối);
 *  - lỗi BE hiện role="alert", KHÔNG đóng dialog (ChatSyncRevokeError ⇒ trạng thái CHƯA đổi).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hrApi, useAuthStore } from "@mediaos/web-core";
import { ChangeStatusDialog, allowedTransitions } from "./ChangeStatusDialog";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    hrApi: { ...actual.hrApi, changeEmployeeStatus: vi.fn() },
  };
});

const ACTOR_USER_ID = "user-actor";

function renderDialog(props: Partial<React.ComponentProps<typeof ChangeStatusDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ChangeStatusDialog
        employeeId="emp-001"
        currentStatus="active"
        currentEndDate={null}
        employeeUserId={null}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose };
}

function optionValues(): string[] {
  const select = screen.getByTestId("change-status-select") as HTMLSelectElement;
  return Array.from(select.options)
    .map((o) => o.value)
    .filter((v) => v !== "");
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: ACTOR_USER_ID, email: "actor@a.test" } as never,
    capabilities: {},
  });
  vi.mocked(hrApi.changeEmployeeStatus).mockResolvedValue({ id: "emp-001", status: "resigned" });
});

describe("ChangeStatusDialog — lọc theo FSM", () => {
  it.each([
    ["active", ["inactive", "resigned", "terminated"]],
    ["inactive", ["active", "resigned", "terminated"]],
    ["resigned", ["terminated"]],
    ["terminated", []],
  ])("từ %s chỉ cho chọn đúng tập hợp lệ", (from, expected) => {
    renderDialog({ currentStatus: from });
    expect(optionValues()).toEqual(expected);
  });

  it("status LẠ (DTO là z.string()) ⇒ 0 lựa chọn, KHÔNG nổ", () => {
    // Fail-closed: thà không cho chọn còn hơn `.map()` trên undefined hoặc gửi transition bịa.
    expect(allowedTransitions("Probation")).toEqual([]);
    renderDialog({ currentStatus: "Probation" });
    expect(optionValues()).toEqual([]);
  });
});

describe("ChangeStatusDialog — ngày nghỉ việc", () => {
  it("chỉ hiện ô ngày khi sang trạng thái rời công ty", () => {
    renderDialog({ currentStatus: "active" });
    expect(screen.queryByTestId("change-status-end-date")).toBeNull();

    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "inactive" },
    });
    expect(screen.queryByTestId("change-status-end-date")).toBeNull();

    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "resigned" },
    });
    expect(screen.getByTestId("change-status-end-date")).toBeTruthy();
  });

  it("chưa nhập ngày ⇒ nút xác nhận disabled (không để server phải trả 400)", () => {
    renderDialog({ currentStatus: "active" });
    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "resigned" },
    });
    expect((screen.getByTestId("change-status-submit") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("change-status-end-date"), {
      target: { value: "2026-08-08" },
    });
    expect((screen.getByTestId("change-status-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("cảnh báo GHI ĐÈ khi hồ sơ đã có ngày nghỉ cũ", () => {
    renderDialog({ currentStatus: "resigned", currentEndDate: "2026-01-31" });
    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "terminated" },
    });
    expect(screen.getByText(/2026-01-31/)).toBeTruthy();
  });

  it("transition KHÔNG rời công ty: KHÔNG gửi endDate (server CẤM, 400)", async () => {
    renderDialog({ currentStatus: "active" });
    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "inactive" },
    });
    fireEvent.click(screen.getByTestId("change-status-submit"));

    await waitFor(() => expect(hrApi.changeEmployeeStatus).toHaveBeenCalled());
    const body = vi.mocked(hrApi.changeEmployeeStatus).mock.calls[0][1];
    expect(body).not.toHaveProperty("endDate");
    expect(body.newStatus).toBe("inactive");
  });
});

describe("ChangeStatusDialog — khoá tài khoản", () => {
  it("ẩn checkbox ở transition không rời công ty (BE bỏ qua lockUser ở đó)", () => {
    renderDialog({ currentStatus: "active", employeeUserId: "user-other" });
    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "inactive" },
    });
    expect(screen.queryByTestId("change-status-lock-user")).toBeNull();
  });

  it("hiện checkbox khi rời công ty trên hồ sơ NGƯỜI KHÁC", () => {
    renderDialog({ currentStatus: "active", employeeUserId: "user-other" });
    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "resigned" },
    });
    expect(screen.getByTestId("change-status-lock-user")).toBeTruthy();
  });

  it("ẩn checkbox trên hồ sơ của CHÍNH người bấm — và không gửi lockUser=true", async () => {
    // Ca ALLOW ở trên là cái làm ca này có nghĩa: nếu checkbox biến mất ở MỌI nơi thì ca này xanh rỗng.
    renderDialog({ currentStatus: "active", employeeUserId: ACTOR_USER_ID });
    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "resigned" },
    });
    expect(screen.queryByTestId("change-status-lock-user")).toBeNull();

    fireEvent.change(screen.getByTestId("change-status-end-date"), {
      target: { value: "2026-08-08" },
    });
    fireEvent.click(screen.getByTestId("change-status-submit"));
    await waitFor(() => expect(hrApi.changeEmployeeStatus).toHaveBeenCalled());
    expect(vi.mocked(hrApi.changeEmployeeStatus).mock.calls[0][1].lockUser).toBe(false);
  });
});

describe("ChangeStatusDialog — lỗi & trạng thái chờ", () => {
  it("lỗi BE ⇒ role=alert, dialog KHÔNG đóng (trạng thái chưa đổi)", async () => {
    vi.mocked(hrApi.changeEmployeeStatus).mockRejectedValue(new Error("revoke failed"));
    const { onClose } = renderDialog({ currentStatus: "active" });
    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "inactive" },
    });
    fireEvent.click(screen.getByTestId("change-status-submit"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("thành công ⇒ đóng dialog", async () => {
    const { onClose } = renderDialog({ currentStatus: "active" });
    fireEvent.change(screen.getByTestId("change-status-select"), {
      target: { value: "inactive" },
    });
    fireEvent.click(screen.getByTestId("change-status-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("chưa chọn trạng thái ⇒ nút disabled", () => {
    renderDialog({ currentStatus: "active" });
    expect((screen.getByTestId("change-status-submit") as HTMLButtonElement).disabled).toBe(true);
  });
});
