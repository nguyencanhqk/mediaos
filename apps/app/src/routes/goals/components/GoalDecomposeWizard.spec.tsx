/**
 * S5-GOAL-TPL-1 — GoalDecomposeWizard (GOAL-SCREEN-004, phân rã mục tiêu từ template).
 *
 * Phủ những thứ CHỈ ở client (BE đã có int-spec riêng):
 *  · chọn template ⇒ nạp việc mẫu vào preview; sửa/xoá/thêm dòng đổi đúng payload gửi lên;
 *  · NEO KHÔNG do client gửi: payload TUYỆT ĐỐI không mang projectId/departmentId (server tự suy —
 *    gửi kèm sẽ bị Zod `strict` chặn và làm người đọc tưởng client quyết được neo);
 *  · mục tiêu cấp nhân viên ⇒ KHÔNG có ô gán người (khai người khác = 422 GOAL-ERR-008 ở BE);
 *  · mục tiêu cấp phòng ⇒ KHÔNG có ô cột board (không có dự án nào để đặt cột);
 *  · lỗi 422 từ server hiện NGUYÊN VĂN thông điệp có mã (không thay bằng câu chung).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { GoalDetailResponseDto, TaskTemplateResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: () => true,
    goalApi: { ...actual.goalApi, decompose: vi.fn() },
    taskTemplateApi: {
      ...actual.taskTemplateApi,
      listTemplates: vi.fn(),
      getTemplate: vi.fn(),
    },
    taskStatesApi: { ...actual.taskStatesApi, listStates: vi.fn() },
    hrApi: { ...actual.hrApi, listEmployees: vi.fn() },
  };
});

import { ApiError, goalApi, hrApi, taskStatesApi, taskTemplateApi } from "@mediaos/web-core";
import { GoalDecomposeWizard } from "./GoalDecomposeWizard";

const mockDecompose = goalApi.decompose as ReturnType<typeof vi.fn>;
const mockListTemplates = taskTemplateApi.listTemplates as ReturnType<typeof vi.fn>;
const mockGetTemplate = taskTemplateApi.getTemplate as ReturnType<typeof vi.fn>;
const mockListStates = taskStatesApi.listStates as ReturnType<typeof vi.fn>;
const mockListEmployees = hrApi.listEmployees as ReturnType<typeof vi.fn>;

function makeGoal(over: Partial<GoalDetailResponseDto> = {}): GoalDetailResponseDto {
  return {
    id: "g-1",
    companyId: "co-1",
    goalCode: "GOAL-0001",
    name: "Mục tiêu dự án",
    description: null,
    level: "project",
    departmentId: null,
    projectId: "p-1",
    employeeId: null,
    parentGoalId: null,
    ownerEmployeeId: "emp-1",
    periodType: "quarter",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    measureType: "percent",
    targetValue: null,
    currentValue: null,
    unit: null,
    progressMode: "tasks",
    progressPercent: null,
    weight: 1,
    status: "Active",
    finalizedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    parent: null,
    childCount: 0,
    ...over,
  } as GoalDetailResponseDto;
}

const TEMPLATE: TaskTemplateResponseDto = {
  id: "tpl-1",
  name: "Quy trình ra mắt",
  description: null,
  departmentId: null,
  departmentName: null,
  isActive: true,
  itemCount: 2,
  items: [
    {
      id: "it-1",
      templateId: "tpl-1",
      title: "Chốt phạm vi",
      description: null,
      defaultPriority: "high",
      estimateHours: 8,
      checklist: ["A", "B"],
      sortOrder: 0,
    },
    {
      id: "it-2",
      templateId: "tpl-1",
      title: "Thiết kế",
      description: null,
      defaultPriority: null,
      estimateHours: null,
      checklist: [],
      sortOrder: 1,
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderWizard(goal: GoalDetailResponseDto, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <GoalDecomposeWizard goal={goal} onClose={onClose} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

async function pickTemplate() {
  // PHẢI đợi <option> render xong: jsdom (như trình duyệt) BỎ QUA giá trị không có trong options ⇒
  // fireEvent.change quá sớm để lại value="" và preview không bao giờ hiện (xanh-giả kiểu khác).
  await waitFor(() => expect(screen.getByRole("option", { name: /Quy trình ra mắt/ })).toBeTruthy());
  fireEvent.change(screen.getByTestId("goal-decompose-template"), { target: { value: "tpl-1" } });
  await waitFor(() => expect(screen.getAllByTestId("goal-decompose-row")).toHaveLength(2));
}

describe("GoalDecomposeWizard (GOAL-SCREEN-004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    mockGetTemplate.mockResolvedValue(TEMPLATE);
    mockListStates.mockResolvedValue([
      { id: "st-1", projectId: "p-1", name: "Cần làm", stateGroup: "unstarted" },
    ]);
    mockListEmployees.mockResolvedValue({ items: [{ id: "emp-2", fullName: "Trần B" }] });
    mockDecompose.mockResolvedValue({ goalId: "g-1", templateId: "tpl-1", created: 2, tasks: [] });
  });

  it("nạp việc mẫu vào preview và gửi ĐÚNG payload (KHÔNG có neo dự án/phòng)", async () => {
    renderWizard(makeGoal());
    await pickTemplate();

    fireEvent.click(screen.getByTestId("goal-decompose-submit"));
    await waitFor(() => expect(mockDecompose).toHaveBeenCalled());

    const [goalId, body] = mockDecompose.mock.calls[0];
    expect(goalId).toBe("g-1");
    expect(body.templateId).toBe("tpl-1");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      templateItemId: "it-1",
      title: "Chốt phạm vi",
      priority: "high",
      checklist: ["A", "B"],
    });
    // Ưu tiên 'none' (item không có defaultPriority) KHÔNG được gửi — server hiểu vắng = không đặt.
    expect(body.items[1]).not.toHaveProperty("priority");
    // NEO là việc của SERVER (SPEC-10 §12) — client không gửi, kể cả khi biết projectId.
    for (const item of body.items) {
      expect(item).not.toHaveProperty("projectId");
      expect(item).not.toHaveProperty("departmentId");
    }
  });

  it("sửa tiêu đề · xoá dòng · thêm dòng phản ánh đúng vào payload", async () => {
    renderWizard(makeGoal());
    await pickTemplate();

    fireEvent.change(screen.getByDisplayValue("Chốt phạm vi"), {
      target: { value: "Chốt phạm vi (đã sửa)" },
    });
    fireEvent.click(screen.getByTestId("goal-decompose-remove-1")); // xoá "Thiết kế"
    fireEvent.click(screen.getByTestId("goal-decompose-add"));
    const rows = screen.getAllByTestId("goal-decompose-row");
    expect(rows).toHaveLength(2);
    // Dòng mới thêm: chưa có tiêu đề ⇒ KHÔNG được tính vào lô gửi lên (server sẽ 400 vì title rỗng).
    fireEvent.click(screen.getByTestId("goal-decompose-submit"));
    await waitFor(() => expect(mockDecompose).toHaveBeenCalled());
    const body = mockDecompose.mock.calls[0][1];
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Chốt phạm vi (đã sửa)");
  });

  it("mục tiêu cấp nhân viên: KHÔNG có ô gán người (neo ép về chủ thể ở server)", async () => {
    renderWizard(makeGoal({ level: "employee", projectId: null, employeeId: "emp-9" }));
    await pickTemplate();
    expect(screen.queryByLabelText(i18n.t("goals:decompose.fields.assignee"))).toBeNull();
    expect(screen.queryByLabelText(i18n.t("goals:decompose.fields.state"))).toBeNull();
  });

  it("mục tiêu cấp phòng: có ô gán người nhưng KHÔNG có cột board", async () => {
    renderWizard(makeGoal({ level: "department", projectId: null, departmentId: "d-1" }));
    await pickTemplate();
    expect(screen.getAllByLabelText(i18n.t("goals:decompose.fields.assignee")).length).toBe(2);
    expect(screen.queryByLabelText(i18n.t("goals:decompose.fields.state"))).toBeNull();
    // Không có dự án ⇒ KHÔNG gọi API cột board (gọi = query rác + có thể 404).
    expect(mockListStates).not.toHaveBeenCalled();
  });

  it("lỗi 422 từ server hiện NGUYÊN VĂN thông điệp có mã GOAL-ERR-XXX", async () => {
    mockDecompose.mockRejectedValue(
      new ApiError(
        422,
        "GOAL-ERR-009",
        "GOAL-ERR-009: không phân rã được mục tiêu — mục tiêu đã huỷ (Cancelled).",
      ),
    );
    renderWizard(makeGoal());
    await pickTemplate();
    fireEvent.click(screen.getByTestId("goal-decompose-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("goal-decompose-error").textContent).toContain("GOAL-ERR-009"),
    );
  });
});
