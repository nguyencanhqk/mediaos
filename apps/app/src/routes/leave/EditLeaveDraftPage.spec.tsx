/**
 * S3-FE-LEAVE-3 — EditLeaveDraftPage tests (LEAVE-SCREEN-002E).
 *
 * DENY-PATH FIRST (RED cho việc nhạy cảm):
 *  (a) update-draft:leave=false → forbidden mềm + KHÔNG gọi getMyRequest.
 *  (b) anti-false-green: gate gọi ĐÚNG cặp update-draft:leave (không hard-code true).
 *  (c) đơn KHÔNG còn Draft (đã Pending) → chặn MỀM ở FE (editLocked), form KHÔNG mount, KHÔNG gọi updateDraft.
 * + Happy path: pre-fill từ getMyRequest, sửa field, "Lưu thay đổi" → gọi updateDraft(id, body) đúng shape.
 * + 409 LEAVE-ERR-INVALID-STATE (đơn đổi trạng thái ở tab khác ngay lúc submit) → lỗi mềm inline, không crash.
 * + Nút "Lưu thay đổi" disable khi form CHƯA dirty (tránh PATCH rỗng).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSetDirtyFormState = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/stores/layout.store", () => ({
  useLayoutStore: (
    selector: (s: { setDirtyFormState: typeof mockSetDirtyFormState }) => unknown,
  ) => {
    const state = { setDirtyFormState: mockSetDirtyFormState };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

vi.mock("@/hooks/use-current-route-meta", () => ({
  useCurrentRouteMeta: () => ({ routeKey: "leave.my-requests" }),
}));

vi.mock("@mediaos/web-core", () => {
  class MockApiError extends Error {
    status: number;
    code: string;
    constructor(opts: { message: string; status: number; code: string }) {
      super(opts.message);
      this.status = opts.status;
      this.code = opts.code;
      this.name = "ApiError";
    }
  }
  return {
    useCan: vi.fn(() => true),
    ApiError: MockApiError,
    leaveApi: {
      getMyRequest: vi.fn(),
      updateDraft: vi.fn(),
      listTypes: vi.fn().mockResolvedValue([
        {
          id: "lt-1",
          name: "Nghỉ phép năm",
          code: "ANNUAL",
          paid: true,
          status: "active",
          description: null,
          deductBalance: true,
          balanceUnit: "Day",
          allowFullDay: true,
          allowHalfDay: true,
          allowHourly: false,
          allowMultipleDays: true,
          requireReason: false,
          requireAttachment: false,
          minNoticeDays: null,
          maxDaysPerRequest: null,
          maxHoursPerRequest: null,
          sortOrder: 1,
        },
      ]),
    },
    leaveKeys: {
      types: { list: () => ["leave", "types", "list"] },
      requests: {
        detail: (id: string) => ["leave", "requests", "detail", id],
        my: (p?: unknown) => ["leave", "requests", "my", p],
      },
      all: ["leave"],
    },
    leaveInvalidation: {
      updateDraft: (id: string) => [
        ["leave", "requests", "my"],
        ["leave", "requests", "detail", id],
      ],
    },
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {children}
      </div>
    ),
  };
});

import { useCan, leaveApi, ApiError } from "@mediaos/web-core";
import { EditLeaveDraftPage } from "./EditLeaveDraftPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetMyRequest = leaveApi.getMyRequest as ReturnType<typeof vi.fn>;
const mockUpdateDraft = leaveApi.updateDraft as ReturnType<typeof vi.fn>;

const DRAFT_DETAIL = {
  id: "req-1",
  leaveTypeId: "lt-1",
  leaveTypeCode: "ANNUAL",
  leaveTypeName: "Nghỉ phép năm",
  startDate: "2026-07-10",
  endDate: "2026-07-11",
  durationType: "FullDay",
  totalDays: 2,
  totalHours: null,
  status: "Draft",
  reason: "Về quê",
  balanceEffectStatus: null,
  submittedAt: null,
  createdAt: "2026-07-01T02:50:00.000Z",
  employeeId: "emp-1",
  leavePolicyId: null,
  halfDaySession: null,
  startTime: null,
  endTime: null,
  handoverNote: null,
  contactDuringLeave: null,
  cancelReason: null,
  cancelledAt: null,
  days: [],
  approvals: [],
};

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <EditLeaveDraftPage requestId="req-1" />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
});

// ── Deny-path gate ─────────────────────────────────────────────────────────────

describe("EditLeaveDraftPage — gate update-draft:leave", () => {
  it("(a) forbidden mềm + KHÔNG gọi getMyRequest khi update-draft:leave=false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(screen.getAllByText(/không có quyền sửa/i).length).toBeGreaterThan(0);
    expect(mockGetMyRequest).not.toHaveBeenCalled();
  });

  it("(b) anti-false-green: gate gọi ĐÚNG cặp update-draft:leave (không hard-code true)", async () => {
    mockGetMyRequest.mockResolvedValue(DRAFT_DETAIL);
    renderPage(buildQC());
    await waitFor(() => expect(mockGetMyRequest).toHaveBeenCalledWith("req-1"));
    expect(mockUseCan).toHaveBeenCalledWith("update-draft", "leave");
  });
});

// ── Draft-only guard ───────────────────────────────────────────────────────────

describe("EditLeaveDraftPage — đơn không còn Draft", () => {
  it("(c) status='Pending' → chặn mềm (editLocked), form KHÔNG mount, KHÔNG gọi updateDraft", async () => {
    mockGetMyRequest.mockResolvedValue({ ...DRAFT_DETAIL, status: "Pending" });
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không thể sửa đơn nghỉ/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /lưu thay đổi/i })).not.toBeInTheDocument();
    expect(mockUpdateDraft).not.toHaveBeenCalled();
  });
});

// ── Happy path: pre-fill + save ────────────────────────────────────────────────

describe("EditLeaveDraftPage — sửa đơn nháp thành công", () => {
  it("pre-fill từ getMyRequest, sửa lý do, Lưu thay đổi → updateDraft(id, body) + điều hướng detail", async () => {
    mockGetMyRequest.mockResolvedValue(DRAFT_DETAIL);
    mockUpdateDraft.mockResolvedValue({ ...DRAFT_DETAIL, reason: "Việc gia đình" });
    renderPage(buildQC());

    // Chờ form pre-fill (reason field hiển thị giá trị đã fetch)
    const reasonBox = (await screen.findByDisplayValue("Về quê")) as HTMLTextAreaElement;

    const saveBtn = screen.getByRole("button", { name: /lưu thay đổi/i });
    // Chưa dirty → nút disable (tránh PATCH rỗng)
    expect(saveBtn).toBeDisabled();

    fireEvent.change(reasonBox, { target: { value: "Việc gia đình" } });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(mockUpdateDraft).toHaveBeenCalledWith(
        "req-1",
        expect.objectContaining({ reason: "Việc gia đình", leaveTypeId: "lt-1" }),
      ),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/leave/me/requests/req-1" }),
      ),
    );
  });

  it("409 LEAVE-ERR-INVALID-STATE khi submit → lỗi mềm inline, KHÔNG crash", async () => {
    mockGetMyRequest.mockResolvedValue(DRAFT_DETAIL);
    mockUpdateDraft.mockRejectedValue(
      new ApiError({
        message: "Chỉ sửa được đơn ở trạng thái nháp (hiện tại: Pending)",
        status: 409,
        code: "LEAVE-ERR-INVALID-STATE",
      }),
    );
    renderPage(buildQC());

    const reasonBox = (await screen.findByDisplayValue("Về quê")) as HTMLTextAreaElement;
    fireEvent.change(reasonBox, { target: { value: "Đổi lý do" } });

    const saveBtn = screen.getByRole("button", { name: /lưu thay đổi/i });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);

    await waitFor(() => expect(mockUpdateDraft).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/không còn ở trạng thái nháp/i);
  });
});
