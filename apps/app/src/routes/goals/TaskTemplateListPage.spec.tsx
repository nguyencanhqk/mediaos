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
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-08) — `returnTo` (đã lọc ở validateSearch, xem template-return-to):
 *  · có returnTo ⇒ hộp tạo danh mục tự mở; lưu xong ⇒ invalidate danh sách RỒI MỚI quay lại (wizard
 *    mở lại thấy mẫu mới, không F5); «Quay lại» không lưu cũng về returnTo;
 *  · không returnTo ⇒ lưu xong ở lại trang như cũ; sửa danh mục có sẵn ⇒ không quay lại.
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
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
    },
    hrApi: { ...actual.hrApi, listDepartments: vi.fn() },
  };
});

import { taskTemplateApi, hrApi, taskTemplateKeys } from "@mediaos/web-core";
import { TaskTemplateListPage } from "./TaskTemplateListPage";

const mockList = taskTemplateApi.listTemplates as ReturnType<typeof vi.fn>;
const mockDelete = taskTemplateApi.deleteTemplate as ReturnType<typeof vi.fn>;
const mockDepartments = hrApi.listDepartments as ReturnType<typeof vi.fn>;
const mockCreate = taskTemplateApi.createTemplate as ReturnType<typeof vi.fn>;
const mockUpdate = taskTemplateApi.updateTemplate as ReturnType<typeof vi.fn>;

const RETURN_TO = "/goals/g-1?decompose=resume";

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

function renderPage(props: { returnTo?: string; onReturn?: (to: string) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <TaskTemplateListPage {...props} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { qc, invalidate };
}

describe("TaskTemplateListPage (GOAL-SCREEN-006)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManage.mockReturnValue(true);
    mockList.mockResolvedValue([makeTemplate()]);
    mockDepartments.mockResolvedValue([{ id: "d-1", name: "Phòng Sản phẩm" }]);
    mockDelete.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue(makeTemplate({ id: "tpl-new", name: "Mẫu mới" }));
    mockUpdate.mockResolvedValue(makeTemplate());
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

  describe("returnTo từ wizard phân rã (US-GOAL-QL-08)", () => {
    it("có returnTo ⇒ hộp tạo tự mở; lưu xong invalidate danh sách RỒI quay lại returnTo", async () => {
      const onReturn = vi.fn();
      const { invalidate } = renderPage({ returnTo: RETURN_TO, onReturn });

      const name = await screen.findByTestId("task-template-name");
      fireEvent.change(name, { target: { value: "Mẫu mới" } });
      fireEvent.click(screen.getByTestId("task-template-form-submit"));

      await waitFor(() => expect(onReturn).toHaveBeenCalledWith(RETURN_TO));
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Mẫu mới" }));
      const listPrefix = taskTemplateKeys.list().slice(0, 3);
      const listInvalidation = invalidate.mock.calls.findIndex(
        ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(listPrefix),
      );
      expect(listInvalidation).toBeGreaterThanOrEqual(0);
      expect(invalidate.mock.invocationCallOrder[listInvalidation]!).toBeLessThan(
        onReturn.mock.invocationCallOrder[0]!,
      );
    });

    it("«Quay lại» (không lưu) cũng về returnTo", async () => {
      const onReturn = vi.fn();
      renderPage({ returnTo: RETURN_TO, onReturn });
      await screen.findByTestId("task-template-name");
      fireEvent.click(screen.getByTestId("task-template-return"));
      expect(onReturn).toHaveBeenCalledWith(RETURN_TO);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("không có returnTo ⇒ không tự mở hộp, không có «Quay lại», lưu xong ở lại trang", async () => {
      const onReturn = vi.fn();
      renderPage({ onReturn });
      await waitFor(() => expect(screen.getByText("Quy trình ra mắt")).toBeTruthy());
      expect(screen.queryByTestId("task-template-name")).toBeNull();
      expect(screen.queryByTestId("task-template-return")).toBeNull();

      fireEvent.click(screen.getByTestId("task-template-create"));
      fireEvent.change(screen.getByTestId("task-template-name"), { target: { value: "Mẫu mới" } });
      fireEvent.click(screen.getByTestId("task-template-form-submit"));
      await waitFor(() => expect(mockCreate).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByTestId("task-template-name")).toBeNull());
      expect(onReturn).not.toHaveBeenCalled();
    });

    it("có returnTo nhưng SỬA danh mục có sẵn ⇒ lưu xong không quay lại", async () => {
      const onReturn = vi.fn();
      renderPage({ returnTo: RETURN_TO, onReturn });
      await screen.findByTestId("task-template-name");
      fireEvent.click(screen.getByText(i18n.t("actions.cancel", { ns: "common" })));
      await waitFor(() => expect(screen.getByText("Quy trình ra mắt")).toBeTruthy());

      fireEvent.click(screen.getByLabelText(i18n.t("goals:templates.actions.edit")));
      fireEvent.click(screen.getByTestId("task-template-form-submit"));
      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByTestId("task-template-name")).toBeNull());
      expect(onReturn).not.toHaveBeenCalled();
    });

    it("returnTo ngoài ứng dụng truyền thẳng vào trang ⇒ bị lọc lại: không tự mở hộp, không «Quay lại»", async () => {
      const onReturn = vi.fn();
      renderPage({ returnTo: "//example.org", onReturn });
      await waitFor(() => expect(screen.getByText("Quy trình ra mắt")).toBeTruthy());
      expect(screen.queryByTestId("task-template-name")).toBeNull();
      expect(screen.queryByTestId("task-template-return")).toBeNull();
    });

    it("thiếu manage:task-template ⇒ màn không đủ quyền, returnTo không mở hộp tạo", async () => {
      canManage.mockReturnValue(false);
      renderPage({ returnTo: RETURN_TO, onReturn: vi.fn() });
      expect(screen.getByText(i18n.t("goals:templates.forbidden.title"))).toBeTruthy();
      expect(screen.queryByTestId("task-template-name")).toBeNull();
    });
  });
});
