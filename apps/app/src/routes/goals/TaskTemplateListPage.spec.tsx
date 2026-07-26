/**
 * S5-GOAL-TPL-1 — TaskTemplateListPage (GOAL-SCREEN-006, danh mục việc mẫu).
 *
 * Phủ:
 *  · KHÔNG có `manage:task-template` ⇒ màn rỗng có giải thích + KHÔNG gọi API (không để người dùng
 *    thấy bảng rồi mới ăn 403 từng dòng);
 *  · có quyền ⇒ bảng hiện tên/phòng/số việc mẫu; danh mục dùng-chung hiện nhãn "dùng chung" thay vì
 *    ô trống (trống trông như thiếu dữ liệu);
 *  · xoá ⇒ hỏi xác nhận rồi gọi API (không xoá một-bấm).
 *
 * Deny-path phạm vi dữ liệu (403 `GOAL-ERR-TPL-FORBIDDEN` khi sửa danh mục dùng-chung ở scope
 * Department) là luật SERVER — phủ ở int-spec BE, không mô phỏng lại ở đây.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { TaskTemplateResponseDto } from "@mediaos/contracts";
import i18n from "@/i18n";

const canManage = vi.fn(() => true);

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: () => canManage(),
    taskTemplateApi: {
      ...actual.taskTemplateApi,
      listTemplates: vi.fn(),
      deleteTemplate: vi.fn(),
    },
    hrApi: { ...actual.hrApi, listDepartments: vi.fn() },
  };
});

import { taskTemplateApi, hrApi } from "@mediaos/web-core";
import { TaskTemplateListPage } from "./TaskTemplateListPage";

const mockList = taskTemplateApi.listTemplates as ReturnType<typeof vi.fn>;
const mockDelete = taskTemplateApi.deleteTemplate as ReturnType<typeof vi.fn>;
const mockDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;

function makeTemplate(over: Partial<TaskTemplateResponseDto> = {}): TaskTemplateResponseDto {
  return {
    id: "tpl-1",
    name: "Quy trình ra mắt",
    description: "3 bước chuẩn",
    departmentId: "d-1",
    departmentName: "Phòng Sản phẩm",
    isActive: true,
    itemCount: 3,
    items: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <TaskTemplateListPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("TaskTemplateListPage (GOAL-SCREEN-006)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManage.mockReturnValue(true);
    mockList.mockResolvedValue([makeTemplate()]);
    mockDepartments.mockResolvedValue([{ id: "d-1", name: "Phòng Sản phẩm" }]);
    mockDelete.mockResolvedValue(undefined);
  });

  it("thiếu manage:task-template ⇒ màn rỗng có giải thích, KHÔNG gọi API", async () => {
    canManage.mockReturnValue(false);
    renderPage();
    expect(screen.getByText(i18n.t("goals:templates.forbidden.title"))).toBeTruthy();
    await waitFor(() => expect(mockList).not.toHaveBeenCalled());
  });

  it("hiện danh mục kèm phòng ban + số việc mẫu", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Quy trình ra mắt")).toBeTruthy());
    // Tra theo CELL: "Phòng Sản phẩm" cũng là một <option> của bộ lọc phòng ban ⇒ getByText mơ hồ.
    expect(screen.getByRole("cell", { name: "Phòng Sản phẩm" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "3" })).toBeTruthy();
  });

  it("danh mục dùng-chung (departmentId null) hiện nhãn dùng chung, không để trống", async () => {
    mockList.mockResolvedValue([makeTemplate({ departmentId: null, departmentName: null })]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(i18n.t("goals:templates.sharedLabel"))).toBeTruthy(),
    );
  });

  it("xoá phải qua xác nhận rồi mới gọi API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Quy trình ra mắt")).toBeTruthy());

    fireEvent.click(screen.getByLabelText(i18n.t("goals:templates.actions.delete")));
    expect(mockDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("task-template-delete-confirm"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("tpl-1"));
  });
});
