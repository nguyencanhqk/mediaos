/**
 * S5-GOAL-FE-2 — GoalCheckinDialog (GOAL-SCREEN-005 / GOAL-API-007). Trọng tâm:
 *  (a) ô nhập ĐỔI theo measureType — percent/number/boolean KHÔNG BAO GIỜ hiện cả hai ô
 *      currentValue + progressPercent cùng lúc (gửi cả hai ⇒ 422 GOAL-ERR-006 "ambiguous").
 *  (b) submit CHỈ confidence + note (không đổi số) vẫn hợp lệ (SPEC-10 §13.1).
 *  (c) lỗi ApiError hiện VERBATIM err.message + hộp thoại KHÔNG tự đóng.
 *
 * S20-GOAL-QUICKCHECKIN-1 (US-GOAL-NV-03) — check-in nhanh:
 *  (q1) điền sẵn số hiện tại + «Lần trước: X → chỉ tiêu Y» + con trỏ ở ô số.
 *  (q2) Ctrl/Cmd+Enter gửi, đóng hộp, toast kèm % mới.
 *  (q3) độ tự tin 3 nút, MẶC ĐỊNH KHÔNG CHỌN; mức lần trước chỉ là chú thích; không chọn ⇒ body
 *       KHÔNG có `confidence`.
 *  (q5) GOAL-ERR-005/006 ⇒ giữ dữ liệu, không toast thành công.
 *  (q6) lấy lần trước lỗi ⇒ «Lần trước: —», vẫn check-in được.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { GoalCoreResponseDto, GoalUpdateResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    goalApi: { ...actual.goalApi, checkIn: vi.fn(), listUpdates: vi.fn() },
  };
});

import { goalApi, ApiError } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { GoalCheckinDialog } from "./GoalCheckinDialog";
import { GOAL_CONFIDENCE_LEVELS } from "../constants";

const mockCheckIn = goalApi.checkIn as ReturnType<typeof vi.fn>;
const mockListUpdates = goalApi.listUpdates as ReturnType<typeof vi.fn>;

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

const NUMBER_GOAL: GoalCoreResponseDto = {
  ...BASE_GOAL,
  measureType: "number",
  unit: "đơn",
  targetValue: 100,
  currentValue: 40,
};

function lastUpdate(patch: Partial<GoalUpdateResponseDto> = {}): GoalUpdateResponseDto {
  return {
    id: "u-1",
    goalId: "g-1",
    updateType: "checkin",
    actorUserId: "user-1",
    oldCurrentValue: 30,
    newCurrentValue: 35,
    oldProgressPercent: 30,
    newProgressPercent: 35,
    confidence: 60,
    note: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    ...patch,
  };
}

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

let toastSuccess: MockInstance<typeof toast.success>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIn.mockResolvedValue({ ...BASE_GOAL, progressPercent: 55 });
  mockListUpdates.mockResolvedValue([lastUpdate()]);
  toastSuccess = vi.spyOn(toast, "success");
});

afterEach(() => {
  toastSuccess.mockRestore();
  toast.clear();
});

describe("GoalCheckinDialog — ô nhập theo measureType (KHÔNG bao giờ 2 ô cùng lúc)", () => {
  it("(a1) percent → chỉ ô progressPercent", () => {
    renderDialog({ ...BASE_GOAL, measureType: "percent" });
    expect(screen.getByTestId("goal-checkin-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-current")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-boolean")).not.toBeInTheDocument();
  });

  it("(a2) number → chỉ ô currentValue", () => {
    renderDialog(NUMBER_GOAL);
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
    renderDialog(NUMBER_GOAL);
    fireEvent.change(screen.getByTestId("goal-checkin-current"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalled());
    const body = mockCheckIn.mock.calls[0][1];
    expect(body.currentValue).toBe(12);
    expect(body).not.toHaveProperty("progressPercent");
  });
});

describe("GoalCheckinDialog — check-in không đổi số", () => {
  it("(b) chỉ độ tự tin + note vẫn submit được, body KHÔNG có currentValue/progressPercent", async () => {
    const { onClose } = renderDialog({ ...BASE_GOAL, progressMode: "tasks" });
    // (q4) đo tự động ⇒ không có ô số.
    expect(screen.queryByTestId("goal-checkin-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-checkin-current")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cao" }));
    fireEvent.change(screen.getByTestId("goal-checkin-note"), {
      target: { value: "Bám sát tiến độ" },
    });
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalled());
    const body = mockCheckIn.mock.calls[0][1];
    expect(body).toEqual({ confidence: GOAL_CONFIDENCE_LEVELS.high, note: "Bám sát tiến độ" });
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

describe("GoalCheckinDialog — check-in nhanh (S20-GOAL-QUICKCHECKIN-1)", () => {
  it("(q1) số: ô điền sẵn 40, «Lần trước: 35 đơn → chỉ tiêu 100 đơn», con trỏ ở ô số", async () => {
    renderDialog(NUMBER_GOAL);
    const input = screen.getByTestId("goal-checkin-current") as HTMLInputElement;
    expect(input.value).toBe("40");
    expect(document.activeElement).toBe(input);
    expect(await screen.findByText("Lần trước: 35 đơn → chỉ tiêu 100 đơn")).toBeInTheDocument();
    expect(mockListUpdates).toHaveBeenCalledWith("g-1", { limit: 1 });
  });

  it("(q1b) percent: điền sẵn từ CÙNG cột ô số ghi (currentValue), không lấy progressPercent", () => {
    renderDialog(BASE_GOAL);
    expect((screen.getByTestId("goal-checkin-progress") as HTMLInputElement).value).toBe("8");
  });

  it("(q2) Ctrl+Enter gửi, đóng hộp, toast % mới", async () => {
    const { onClose } = renderDialog(NUMBER_GOAL);
    const input = screen.getByTestId("goal-checkin-current");
    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCheckIn).toHaveBeenCalledWith("g-1", { currentValue: 45 });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(String(toastSuccess.mock.calls[0][0])).toContain("55%");
  });

  it("(q2b) Cmd+Enter (metaKey) cũng gửi", async () => {
    const { onClose } = renderDialog(NUMBER_GOAL);
    fireEvent.keyDown(screen.getByTestId("goal-checkin-note"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCheckIn).toHaveBeenCalledTimes(1);
  });

  it("(q3) lần trước «Vừa»: không nút nào chọn sẵn, chỉ chú thích; không chọn ⇒ body KHÔNG có confidence", async () => {
    renderDialog(NUMBER_GOAL);
    expect(await screen.findByText("Mức tự tin lần trước: Vừa")).toBeInTheDocument();
    for (const name of ["Thấp", "Vừa", "Cao"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalled());
    expect(mockCheckIn.mock.calls[0][1]).not.toHaveProperty("confidence");
  });

  it("(q3b) chọn «Thấp» rồi bấm lại ⇒ bỏ chọn, body không có confidence", async () => {
    renderDialog(NUMBER_GOAL);
    const low = screen.getByRole("button", { name: "Thấp" });
    fireEvent.click(low);
    expect(low).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(low);
    expect(low).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalled());
    expect(mockCheckIn.mock.calls[0][1]).not.toHaveProperty("confidence");
  });

  it.each([
    ["GOAL-ERR-005", "GOAL-ERR-005: mục tiêu đã chốt kỳ."],
    ["GOAL-ERR-006", "GOAL-ERR-006: chỉ check-in được mục tiêu đang chạy."],
  ])("(q5) %s ⇒ giữ số + ghi chú đã gõ, lỗi rõ, KHÔNG toast thành công", async (code, message) => {
    mockCheckIn.mockRejectedValue(new ApiError(422, code, message));
    const { onClose } = renderDialog(NUMBER_GOAL);
    fireEvent.change(screen.getByTestId("goal-checkin-current"), { target: { value: "47" } });
    fireEvent.change(screen.getByTestId("goal-checkin-note"), { target: { value: "Ghi chú" } });
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect((screen.getByTestId("goal-checkin-current") as HTMLInputElement).value).toBe("47");
    expect((screen.getByTestId("goal-checkin-note") as HTMLTextAreaElement).value).toBe("Ghi chú");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("(q6) lấy lần trước lỗi ⇒ «Lần trước: —», vẫn check-in được", async () => {
    mockListUpdates.mockRejectedValue(new ApiError(500, "INTERNAL", "lỗi"));
    const { onClose } = renderDialog(NUMBER_GOAL);
    expect(await screen.findByText("Lần trước: —")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("goal-checkin-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCheckIn).toHaveBeenCalledWith("g-1", { currentValue: 40 });
  });
});
