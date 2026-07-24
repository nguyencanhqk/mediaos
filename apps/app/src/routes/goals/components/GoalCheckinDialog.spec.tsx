/**
 * S5-GOAL-FE-2 — GoalCheckinDialog (GOAL-SCREEN-005 / GOAL-API-007). Trọng tâm:
 *  (a) ô nhập ĐỔI theo measureType — percent/number/boolean KHÔNG BAO GIỜ hiện cả hai ô
 *      currentValue + progressPercent cùng lúc (gửi cả hai ⇒ 422 GOAL-ERR-006 "ambiguous").
 *  (b) submit CHỈ confidence + note (không đổi số) vẫn hợp lệ (SPEC-10 §13.1).
 *  (c) lỗi ApiError hiện VERBATIM err.message + hộp thoại KHÔNG tự đóng.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, goalApi: { ...actual.goalApi, checkIn: vi.fn() } };
});

import { goalApi, ApiError } from "@mediaos/web-core";
import { GoalCheckinDialog } from "./GoalCheckinDialog";

const mockCheckIn = goalApi.checkIn as ReturnType<typeof vi.fn>;

const BASE_GOAL: GoalCoreResponseDto = {
  id: "g-1",
  companyId: "co-1",
  goalCode: "GOAL-0001",
  name: "Tăng doanh thu 20%",
  description: null,
  level: "department",
  departmentId: "dept-1",
  projectId: null,
  employeeId: null,
  parentGoalId: null,
  ownerEmployeeId: "emp-1",
  periodType: "quarter",
  periodStart: "2026-01-01",
  periodEnd: "2026-03-31",
  measureType: "percent",
  targetValue: 20,
  currentValue: 8,
  unit: "%",
  progressMode: "manual",
  progressPercent: 40,
  weight: 1,
  status: "Active",
  finalizedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderDialog(goal: GoalCoreResponseDto, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <GoalCheckinDialog goal={goal} onClose={onClose} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIn.mockResolvedValue({ ...BASE_GOAL, progressPercent: 55 });
});

describe("GoalCheckinDialog — ô nhập theo measureType (KHÔNG bao giờ 2 ô cùng lúc)", () => {
  it("(a1) percent → chỉ ô progressPercent", () => {
    renderDialog({ ...BASE_GOAL, measureType: "percent" });
    expect(screen.getByTestId("goal-checkin-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-current")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-boolean")).not.toBeInTheDocument();
  });

  it("(a2) number → chỉ ô currentValue", () => {
    renderDialog({ ...BASE_GOAL, measureType: "number", unit: "đơn" });
    expect(screen.getByTestId("goal-checkin-current")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-boolean")).not.toBeInTheDocument();
  });

  it("(a3) boolean → chỉ toggle đạt/chưa đạt", () => {
    renderDialog({ ...BASE_GOAL, measureType: "boolean" });
    expect(screen.getByTestId("goal-checkin-boolean")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-current")).not.toBeInTheDocument();
  });

  it("(a4) percent: submit gửi progressPercent, TUYỆT ĐỐI không kèm currentValue", async () => {
    renderDialog({ ...BASE_GOAL, measureType: "percent" });
    fireEvent.change(screen.getByTestId("goal-checkin-progress"), { target: { value: "55" } });
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalled());
    const body = mockCheckIn.mock.calls[0][1];
    expect(body.progressPercent).toBe(55);
    expect(body).not.toHaveProperty("currentValue");
  });

  it("(a5) number: submit gửi currentValue, KHÔNG kèm progressPercent", async () => {
    renderDialog({ ...BASE_GOAL, measureType: "number", unit: "đơn" });
    fireEvent.change(screen.getByTestId("goal-checkin-current"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalled());
    const body = mockCheckIn.mock.calls[0][1];
    expect(body.currentValue).toBe(12);
    expect(body).not.toHaveProperty("progressPercent");
  });
});

describe("GoalCheckinDialog — check-in không đổi số", () => {
  it("(b) chỉ confidence + note vẫn submit được, body KHÔNG có currentValue/progressPercent", async () => {
    const { onClose } = renderDialog({ ...BASE_GOAL, progressMode: "tasks" });
    fireEvent.change(screen.getByTestId("goal-checkin-confidence"), { target: { value: "70" } });
    fireEvent.change(screen.getByTestId("goal-checkin-note"), {
      target: { value: "Bám sát tiến độ" },
    });
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalled());
    const body = mockCheckIn.mock.calls[0][1];
    expect(body).toEqual({ confidence: 70, note: "Bám sát tiến độ" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("GoalCheckinDialog — lỗi từ server", () => {
  it("(c) ApiError GOAL-ERR-006 → hiện đúng err.message, hộp thoại KHÔNG tự đóng", async () => {
    mockCheckIn.mockRejectedValue(
      new ApiError(422, "GOAL-ERR-006", "Chỉ được gửi một trong hai giá trị đo."),
    );
    const { onClose } = renderDialog(BASE_GOAL);
    fireEvent.change(screen.getByTestId("goal-checkin-progress"), { target: { value: "55" } });
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() =>
      expect(screen.getByText("Chỉ được gửi một trong hai giá trị đo.")).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
