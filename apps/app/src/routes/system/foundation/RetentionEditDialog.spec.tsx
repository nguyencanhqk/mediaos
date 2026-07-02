// @vitest-environment jsdom
/**
 * RetentionEditDialog — S2-FE-FND-6.
 *
 * Xác nhận: submit form → PHẢI qua ConfirmDialog (retention governs purge, FRONTEND-13 §6.6) TRƯỚC khi
 * gọi retentionApi.update — không mutate ngay khi bấm "Lưu". Body PATCH KHÔNG chứa id/moduleCode/
 * entityType/companyId (contract .strict() chặn leo thang — form chỉ gửi field mutable).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  retentionApi: {
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

import { retentionApi, type RetentionPolicyView } from "@mediaos/web-core";
import { RetentionEditDialog } from "./RetentionEditDialog";

const mockUpdate = retentionApi.update as ReturnType<typeof vi.fn>;

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

function renderDialog(qc: QueryClient, onClose = vi.fn()) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <RetentionEditDialog open onClose={onClose} policy={POLICY} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RetentionEditDialog", () => {
  it("submit form → opens ConfirmDialog WITHOUT calling retentionApi.update yet", async () => {
    renderDialog(buildQC());

    fireEvent.click(screen.getByTestId("retention-form-submit"));

    // react-hook-form handleSubmit là async (chạy resolver) — chờ ConfirmDialog xuất hiện.
    await screen.findByRole("dialog", { name: /xác nhận thay đổi/i });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("confirm → calls retentionApi.update(id, body) with mutable fields only (no id/company)", async () => {
    mockUpdate.mockResolvedValue({ ...POLICY, retentionDays: 400 });
    const onClose = vi.fn();
    renderDialog(buildQC(), onClose);

    fireEvent.click(screen.getByTestId("retention-form-submit"));
    const dialog = await screen.findByRole("dialog", { name: /xác nhận thay đổi/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /xác nhận lưu/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, body] = mockUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(POLICY.id);
    expect(body).toEqual({
      retentionDays: 365,
      cleanupAction: "Archive",
      archiveAfterDays: 180,
      deleteAfterDays: null,
      isEnabled: true,
      description: undefined,
    });
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("moduleCode");
    expect(body).not.toHaveProperty("entityType");
    expect(body).not.toHaveProperty("companyId");

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("cancel confirm → does NOT call retentionApi.update", async () => {
    renderDialog(buildQC());

    fireEvent.click(screen.getByTestId("retention-form-submit"));
    const dialog = await screen.findByRole("dialog", { name: /xác nhận thay đổi/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /xem lại/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /xác nhận thay đổi/i })).not.toBeInTheDocument(),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("shows API error message when update fails", async () => {
    mockUpdate.mockRejectedValue({ status: 403 });
    renderDialog(buildQC());

    fireEvent.click(screen.getByTestId("retention-form-submit"));
    const dialog = await screen.findByRole("dialog", { name: /xác nhận thay đổi/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /xác nhận lưu/i }));

    await waitFor(() =>
      expect(screen.getByText(/bạn không có quyền thực hiện thao tác này/i)).toBeInTheDocument(),
    );
  });
});
