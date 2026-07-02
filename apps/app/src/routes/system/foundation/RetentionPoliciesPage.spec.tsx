// @vitest-environment jsdom
/**
 * [deny-path] RetentionPoliciesPage — S2-FE-FND-6.
 *
 * Gate: view/manage:foundation-retention (cặp seed thật mig 0435, S2-FND-BE-3).
 *  - THIẾU view → forbidden EmptyState, KHÔNG gọi retentionApi.list.
 *  - THIẾU manage (is_sensitive=true, System-scope — bình thường company-admin KHÔNG có) → list render
 *    nhưng nút Sửa ẨN (anti dead-button).
 *  - Có manage → nút Sửa hiện, mở RetentionEditDialog.
 * DataTable dùng THẬT (không mock) — chỉ mock PageHeader/EmptyState (pattern PublicHolidaysPage.spec.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  retentionApi: {
    list: vi.fn(),
    update: vi.fn(),
  },
  foundationKeys: {
    retentionPolicies: {
      all: ["foundation", "retention-policies"],
      list: () => ["foundation", "retention-policies", "list"],
    },
  },
  foundationInvalidation: {
    updateRetentionPolicy: () => [["foundation", "retention-policies"]],
  },
  CLEANUP_ACTIONS: ["None", "Archive", "Delete", "Anonymize"],
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
      </div>
    ),
    EmptyState: ({
      title,
      description,
      "data-testid": testId,
    }: {
      title: string;
      description?: string;
      "data-testid"?: string;
    }) => (
      <div data-testid={testId ?? "empty-state"}>
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
    // DataTable = actual (unmocked) — cần render cột "actions" thật (nút Sửa).
  };
});

// Dialog sửa test riêng (form validation) — ở đây chỉ cần biết nó KHÔNG mở khi thiếu quyền.
vi.mock("./RetentionEditDialog", () => ({
  RetentionEditDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="retention-edit-dialog" /> : null,
}));

import { useCan, retentionApi, type RetentionPolicyView } from "@mediaos/web-core";
import { RetentionPoliciesPage } from "./RetentionPoliciesPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockList = retentionApi.list as ReturnType<typeof vi.fn>;

const POLICY: RetentionPolicyView = {
  id: "ret-1",
  moduleCode: "AUTH",
  entityType: "login_logs",
  retentionDays: 365,
  cleanupAction: "Archive",
  archiveAfterDays: 180,
  deleteAfterDays: null,
  isLegalHoldSupported: false,
  isEnabled: true,
  description: null,
  updatedAt: "2026-06-01T00:00:00.000Z",
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <RetentionPoliciesPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RetentionPoliciesPage", () => {
  it("[deny] no view:foundation-retention → forbidden EmptyState + list NOT called", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByTestId("retention-forbidden")).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("view only (no manage) → row renders, edit button HIDDEN", async () => {
    mockUseCan.mockImplementation((action: string) => action === "view");
    mockList.mockResolvedValue([POLICY]);

    renderPage(buildQC());

    await waitFor(() => expect(screen.getByText("login_logs")).toBeInTheDocument());
    expect(mockList).toHaveBeenCalled();
    expect(screen.queryByTestId("retention-edit-btn")).not.toBeInTheDocument();
  });

  it("view + manage → edit button shown; click opens RetentionEditDialog", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([POLICY]);

    renderPage(buildQC());

    await waitFor(() => expect(screen.getByText("login_logs")).toBeInTheDocument());
    const editBtn = screen.getByTestId("retention-edit-btn");
    expect(editBtn).toBeInTheDocument();

    fireEvent.click(editBtn);
    expect(screen.getByTestId("retention-edit-dialog")).toBeInTheDocument();
  });

  it("shows error EmptyState when retentionApi.list fails", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockRejectedValue(new Error("Network error"));

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getByText(/không thể tải chính sách lưu trữ/i)).toBeInTheDocument();
    });
  });

  it("shows empty state when list resolves with 0 items", async () => {
    mockUseCan.mockReturnValue(true);
    mockList.mockResolvedValue([]);

    renderPage(buildQC());

    await waitFor(() => {
      expect(screen.getAllByText(/chưa có chính sách lưu trữ/i).length).toBeGreaterThan(0);
    });
  });
});
