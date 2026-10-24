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
 *
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-07 + QL-08):
 *  · «Áp cho tất cả» người + hạn: dòng chưa sửa tay nhận giá trị chung, dòng đã sửa tay giữ riêng;
 *  · `dueAt` = cuối ngày theo `companyTimeZone()` — giá trị kỳ vọng VIẾT CỨNG (không tính lại bằng
 *    chính hàm của mã nguồn); chạy cả dưới `TZ=UTC` lẫn `TZ=America/Los_Angeles` phải ra cùng chuỗi;
 *  · không `read:employee` ⇒ không có ô «Áp người», vẫn tạo được việc chưa giao;
 *  · tạo xong ⇒ bước «Đã tạo n việc», bấm việc mở drawer `?task=`, «Mở board dự án»;
 *  · lỗi BE (đã chốt kỳ, vượt trần) ⇒ giữ dữ liệu đã sửa, báo lỗi, không đóng;
 *  · chưa có mẫu ⇒ thông điệp rỗng + «Tạo mẫu mới» (chỉ khi có `manage:task-template`) với
 *    `?returnTo=` quay lại đúng wizard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type {
  GoalDetailResponseDto,
  TaskTemplateItemResponseDto,
  TaskTemplateResponseDto,
} from "@mediaos/contracts";
import i18n from "@/i18n";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => nav.navigate }));

// Cặp quyền BỊ THU HỒI cho từng test (rỗng = đủ quyền) + múi giờ công ty ghi đè (null = mặc định).
const perm = vi.hoisted(() => ({ denied: new Set<string>() }));
const tz = vi.hoisted(() => ({ zone: null as string | null }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: (action: string, resourceType: string) => !perm.denied.has(`${action}:${resourceType}`),
    companyTimeZone: () => tz.zone ?? actual.companyTimeZone(),
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

import {
  ApiError,
  goalApi,
  hrApi,
  taskStatesApi,
  taskTemplateApi,
  taskTemplateInvalidation,
} from "@mediaos/web-core";
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

const TEN_ITEMS: TaskTemplateItemResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
  id: `it-${i + 1}`,
  templateId: "tpl-1",
  title: `Việc ${i + 1}`,
  description: null,
  defaultPriority: null,
  estimateHours: null,
  checklist: [],
  sortOrder: i,
}));
const TEMPLATE_10: TaskTemplateResponseDto = { ...TEMPLATE, itemCount: 10, items: TEN_ITEMS };

/** 31/10/2026 23:59:59.999 giờ công ty UTC+7 — KHÔNG phải 01/11 06:59 (chuỗi UTC cứng cũ). */
const OCT31_END_UTC7 = "2026-10-31T16:59:59.999Z";
const NOV05_END_UTC7 = "2026-11-05T16:59:59.999Z";
/** Cùng ngày nhưng công ty UTC+9 — chứng minh múi giờ lấy từ `companyTimeZone()`, không viết cứng. */
const OCT31_END_UTC9 = "2026-10-31T14:59:59.999Z";

const label = (key: string) => i18n.t(`goals:decompose.${key}`);

function renderWizard(goal: GoalDetailResponseDto, onClose = vi.fn(), qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <GoalDecomposeWizard goal={goal} onClose={onClose} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onClose, qc: client };
}

async function pickTemplate(rowCount = 2) {
  // PHẢI đợi <option> render xong: jsdom (như trình duyệt) BỎ QUA giá trị không có trong options ⇒
  // fireEvent.change quá sớm để lại value="" và preview không bao giờ hiện (xanh-giả kiểu khác).
  await waitFor(() =>
    expect(screen.getByRole("option", { name: /Quy trình ra mắt/ })).toBeTruthy(),
  );
  fireEvent.change(screen.getByTestId("goal-decompose-template"), { target: { value: "tpl-1" } });
  await waitFor(() => expect(screen.getAllByTestId("goal-decompose-row")).toHaveLength(rowCount));
}

/** Option người phải có TRƯỚC khi đổi <select> (nạp bất đồng bộ — đổi sớm là race, giá trị bị bỏ). */
async function waitForEmployeeOptions() {
  await waitFor(() =>
    expect(screen.getAllByRole("option", { name: "Nguyễn A" }).length).toBeGreaterThan(0),
  );
}

async function submitAndReadBody() {
  fireEvent.click(screen.getByTestId("goal-decompose-submit"));
  await waitFor(() => expect(mockDecompose).toHaveBeenCalled());
  return mockDecompose.mock.calls[0][1];
}

describe("GoalDecomposeWizard (GOAL-SCREEN-004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    perm.denied.clear();
    tz.zone = null;
    mockListTemplates.mockResolvedValue([TEMPLATE]);
    mockGetTemplate.mockResolvedValue(TEMPLATE);
    mockListStates.mockResolvedValue([
      { id: "st-1", projectId: "p-1", name: "Cần làm", stateGroup: "unstarted" },
    ]);
    mockListEmployees.mockResolvedValue({
      items: [
        { id: "emp-a", fullName: "Nguyễn A" },
        { id: "emp-c", fullName: "Lê C" },
      ],
    });
    mockDecompose.mockResolvedValue({ goalId: "g-1", templateId: "tpl-1", created: 2, tasks: [] });
  });

  it("nạp việc mẫu vào preview và gửi ĐÚNG payload (KHÔNG có neo dự án/phòng)", async () => {
    renderWizard(makeGoal());
    await pickTemplate();

    const body = await submitAndReadBody();
    expect(mockDecompose.mock.calls[0][0]).toBe("g-1");
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
    expect(screen.getAllByTestId("goal-decompose-row")).toHaveLength(2);
    // Dòng mới thêm: chưa có tiêu đề ⇒ KHÔNG được tính vào lô gửi lên (server sẽ 400 vì title rỗng).
    const body = await submitAndReadBody();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Chốt phạm vi (đã sửa)");
  });

  it("mục tiêu cấp nhân viên: KHÔNG có ô gán người (neo ép về chủ thể ở server)", async () => {
    renderWizard(makeGoal({ level: "employee", projectId: null, employeeId: "emp-9" }));
    await pickTemplate();
    expect(screen.queryByLabelText(label("fields.assignee"))).toBeNull();
    expect(screen.queryByLabelText(label("applyAll.assignee"))).toBeNull();
    expect(screen.queryByLabelText(label("fields.state"))).toBeNull();
  });

  it("mục tiêu cấp phòng: có ô gán người nhưng KHÔNG có cột board", async () => {
    renderWizard(makeGoal({ level: "department", projectId: null, departmentId: "d-1" }));
    await pickTemplate();
    expect(screen.getAllByLabelText(label("fields.assignee")).length).toBe(2);
    expect(screen.queryByLabelText(label("fields.state"))).toBeNull();
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

  describe("«Áp cho tất cả» người + hạn (US-GOAL-QL-07)", () => {
    beforeEach(() => mockGetTemplate.mockResolvedValue(TEMPLATE_10));

    it("chọn A + 31/10 ⇒ 10 dòng nhận A + 31/10; dòng đã sửa tay giữ giá trị riêng", async () => {
      renderWizard(makeGoal());
      await pickTemplate(10);
      await waitForEmployeeOptions();

      // Sửa tay TRƯỚC: dòng 3 đổi người, dòng 5 đổi hạn.
      fireEvent.change(screen.getAllByLabelText(label("fields.assignee"))[2]!, {
        target: { value: "emp-c" },
      });
      fireEvent.change(screen.getAllByLabelText(label("fields.dueAt"))[4]!, {
        target: { value: "2026-11-05" },
      });
      fireEvent.change(screen.getByLabelText(label("applyAll.assignee")), {
        target: { value: "emp-a" },
      });
      fireEvent.change(screen.getByLabelText(label("applyAll.dueAt")), {
        target: { value: "2026-10-31" },
      });

      const rowAssignees = screen
        .getAllByLabelText(label("fields.assignee"))
        .map((el) => (el as HTMLSelectElement).value);
      expect(rowAssignees).toEqual([
        "emp-a",
        "emp-a",
        "emp-c",
        "emp-a",
        "emp-a",
        "emp-a",
        "emp-a",
        "emp-a",
        "emp-a",
        "emp-a",
      ]);

      const body = await submitAndReadBody();
      expect(body.items).toHaveLength(10);
      body.items.forEach((item: { assigneeEmployeeId?: string; dueAt?: string }, i: number) => {
        expect(item.assigneeEmployeeId).toBe(i === 2 ? "emp-c" : "emp-a");
        expect(item.dueAt).toBe(i === 4 ? NOV05_END_UTC7 : OCT31_END_UTC7);
      });
    });

    it("dòng mới thêm nhận giá trị chung; sửa tay SAU khi áp vẫn được giữ khi áp lại", async () => {
      renderWizard(makeGoal());
      await pickTemplate(10);
      await waitForEmployeeOptions();

      fireEvent.change(screen.getByLabelText(label("applyAll.assignee")), {
        target: { value: "emp-a" },
      });
      fireEvent.change(screen.getAllByLabelText(label("fields.assignee"))[0]!, {
        target: { value: "emp-c" },
      });
      fireEvent.change(screen.getByLabelText(label("applyAll.assignee")), {
        target: { value: "emp-c" },
      });
      fireEvent.change(screen.getByLabelText(label("applyAll.assignee")), {
        target: { value: "emp-a" },
      });
      fireEvent.click(screen.getByTestId("goal-decompose-add"));
      const selects = screen.getAllByLabelText(label("fields.assignee")) as HTMLSelectElement[];
      expect(selects).toHaveLength(11);
      expect(selects[0]!.value).toBe("emp-c");
      expect(selects[1]!.value).toBe("emp-a");
      expect(selects[10]!.value).toBe("emp-a");
    });
  });

  describe("hạn = cuối ngày theo giờ công ty", () => {
    it("công ty UTC+7, hạn 31/10/2026 ⇒ 31/10 23:59:59 giờ công ty (không phải 01/11 06:59)", async () => {
      renderWizard(makeGoal());
      await pickTemplate();
      fireEvent.change(screen.getAllByLabelText(label("fields.dueAt"))[0]!, {
        target: { value: "2026-10-31" },
      });
      const body = await submitAndReadBody();
      expect(body.items[0].dueAt).toBe(OCT31_END_UTC7);
      expect(body.items[0].dueAt).not.toBe("2026-10-31T23:59:59.000Z");
      expect(body.items[1]).not.toHaveProperty("dueAt");
    });

    it("múi giờ lấy từ companyTimeZone(): công ty UTC+9 ⇒ 14:59:59.999Z", async () => {
      tz.zone = "Asia/Tokyo";
      renderWizard(makeGoal());
      await pickTemplate();
      fireEvent.change(screen.getAllByLabelText(label("fields.dueAt"))[0]!, {
        target: { value: "2026-10-31" },
      });
      const body = await submitAndReadBody();
      expect(body.items[0].dueAt).toBe(OCT31_END_UTC9);
    });
  });

  it("không có read:employee ⇒ không có ô «Áp người» (fail-soft), vẫn tạo được việc chưa giao", async () => {
    perm.denied.add("read:employee");
    renderWizard(makeGoal({ level: "department", projectId: null, departmentId: "d-1" }));
    await pickTemplate();
    expect(screen.queryByLabelText(label("applyAll.assignee"))).toBeNull();
    // Ô hạn chung vẫn còn — chỉ phần người là fail-soft.
    expect(screen.getByLabelText(label("applyAll.dueAt"))).toBeTruthy();
    expect(mockListEmployees).not.toHaveBeenCalled();

    const body = await submitAndReadBody();
    expect(body.items).toHaveLength(2);
    for (const item of body.items) expect(item).not.toHaveProperty("assigneeEmployeeId");
  });

  describe("bước «Đã tạo n việc»", () => {
    const CREATED = {
      goalId: "g-1",
      templateId: "tpl-1",
      created: 2,
      tasks: [
        { id: "t-1", taskCode: "TASK-0101", title: "Chốt phạm vi" },
        { id: "t-2", taskCode: null, title: "Thiết kế" },
      ],
    };

    it("liệt kê mã + tiêu đề từ response, KHÔNG tự đóng; bấm việc ⇒ đóng wizard + mở drawer ?task=", async () => {
      mockDecompose.mockResolvedValue(CREATED);
      const { onClose } = renderWizard(makeGoal());
      await pickTemplate();
      fireEvent.click(screen.getByTestId("goal-decompose-submit"));

      await waitFor(() =>
        expect(screen.getByTestId("goal-decompose-result").textContent).toContain(
          i18n.t("goals:decompose.result.title", { count: 2 }),
        ),
      );
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("goal-decompose-result-task-t-1").textContent).toContain(
        "TASK-0101",
      );
      expect(screen.getByTestId("goal-decompose-result-task-t-2").textContent).toContain(
        "Thiết kế",
      );

      fireEvent.click(screen.getByTestId("goal-decompose-result-task-t-1"));
      expect(onClose).toHaveBeenCalled();
      const drawerCall = nav.navigate.mock.calls.at(-1)![0];
      expect(drawerCall.to).toBe(".");
      expect(drawerCall.search({ tab: "linked" })).toEqual({ tab: "linked", task: "t-1" });
    });

    it("«Mở board dự án» ⇒ tab board của đúng dự án neo mục tiêu", async () => {
      mockDecompose.mockResolvedValue(CREATED);
      const { onClose } = renderWizard(makeGoal());
      await pickTemplate();
      fireEvent.click(screen.getByTestId("goal-decompose-submit"));
      await waitFor(() => expect(screen.getByTestId("goal-decompose-open-board")).toBeTruthy());

      fireEvent.click(screen.getByTestId("goal-decompose-open-board"));
      expect(onClose).toHaveBeenCalled();
      expect(nav.navigate).toHaveBeenCalledWith({
        to: "/tasks/projects/$projectId",
        params: { projectId: "p-1" },
        search: { tab: "board" },
      });
    });

    it("mục tiêu cấp phòng (không có dự án) ⇒ không có «Mở board dự án»", async () => {
      mockDecompose.mockResolvedValue(CREATED);
      renderWizard(makeGoal({ level: "department", projectId: null, departmentId: "d-1" }));
      await pickTemplate();
      fireEvent.click(screen.getByTestId("goal-decompose-submit"));
      await waitFor(() => expect(screen.getByTestId("goal-decompose-result")).toBeTruthy());
      expect(screen.queryByTestId("goal-decompose-open-board")).toBeNull();
    });

    it("không có read:task ⇒ tên việc là chữ thường, không có lối mở drawer", async () => {
      perm.denied.add("read:task");
      mockDecompose.mockResolvedValue(CREATED);
      renderWizard(makeGoal());
      await pickTemplate();
      fireEvent.click(screen.getByTestId("goal-decompose-submit"));
      await waitFor(() => expect(screen.getByTestId("goal-decompose-result")).toBeTruthy());
      expect(screen.getByText("Thiết kế")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Thiết kế/ })).toBeNull();
    });
  });

  describe("lỗi BE ⇒ giữ dữ liệu, báo lỗi, không đóng", () => {
    it.each([
      ["GOAL-ERR-005", "GOAL-ERR-005: mục tiêu đã chốt kỳ — không ghi được."],
      ["GOAL-ERR-009", "GOAL-ERR-009: tối đa 50 việc mỗi lần phân rã."],
    ])("%s", async (code, message) => {
      mockDecompose.mockRejectedValue(new ApiError(422, code, message));
      const { onClose } = renderWizard(makeGoal());
      await pickTemplate();
      fireEvent.change(screen.getByDisplayValue("Thiết kế"), {
        target: { value: "Thiết kế (đã sửa)" },
      });
      fireEvent.click(screen.getByTestId("goal-decompose-submit"));

      await waitFor(() =>
        expect(screen.getByTestId("goal-decompose-error").textContent).toContain(code),
      );
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByTestId("goal-decompose-result")).toBeNull();
      expect(screen.getByDisplayValue("Thiết kế (đã sửa)")).toBeTruthy();
      expect(screen.getAllByTestId("goal-decompose-row")).toHaveLength(2);
      expect((screen.getByTestId("goal-decompose-submit") as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  describe("chưa có mẫu (US-GOAL-QL-08)", () => {
    beforeEach(() => mockListTemplates.mockResolvedValue([]));

    it("có manage:task-template ⇒ thông điệp rỗng + «Tạo mẫu mới» mang returnTo về đúng wizard", async () => {
      const { onClose } = renderWizard(makeGoal());
      await waitFor(() => expect(screen.getByText(label("noTemplates"))).toBeTruthy());

      fireEvent.click(screen.getByTestId("goal-decompose-create-template"));
      expect(onClose).toHaveBeenCalled();
      expect(nav.navigate).toHaveBeenCalledWith({
        to: "/goals/templates",
        search: { returnTo: "/goals/g-1?decompose=resume" },
      });
    });

    it("không có manage:task-template ⇒ chỉ thông điệp rỗng, KHÔNG có «Tạo mẫu mới»", async () => {
      perm.denied.add("manage:task-template");
      renderWizard(makeGoal());
      await waitFor(() => expect(screen.getByText(label("noTemplates"))).toBeTruthy());
      expect(screen.queryByTestId("goal-decompose-create-template")).toBeNull();
    });

    it("tạo mẫu xong (invalidate create) mở lại wizard ⇒ mẫu mới có trong danh sách, không F5", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderWizard(makeGoal(), vi.fn(), qc);
      await waitFor(() => expect(screen.getByText(label("noTemplates"))).toBeTruthy());
      cleanup();

      mockListTemplates.mockResolvedValue([TEMPLATE]);
      await Promise.all(
        taskTemplateInvalidation.create().map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
      renderWizard(makeGoal(), vi.fn(), qc);
      await waitFor(() =>
        expect(screen.getByRole("option", { name: /Quy trình ra mắt/ })).toBeTruthy(),
      );
    });
  });
});
