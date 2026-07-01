/**
 * S3-FE-LEAVE-2 — LeaveApprovalPage tests (crown: workflow phê duyệt FE).
 *
 * DENY-PATH FIRST (RED cho việc nhạy cảm):
 *  (a) view:leave=false → forbidden mềm + KHÔNG gọi listRequests.
 *  (b) approve:leave=false → nút approve+reject KHÔNG render trong detail dialog.
 *  (c) approve có, reject 403 (thiếu reject:leave — BE fail-closed) → lỗi mềm, list KHÔNG optimistic-apply.
 *  (d) approve ngoài scope → approveRequest 403 → lỗi mềm.
 *  + reject reason BẮT BUỘC: submit rỗng → KHÔNG gọi rejectRequest.
 *  + QA-05 happy-path: manager duyệt 1 đơn Pending → list refetch (invalidate), dialog đóng.
 *  + anti-false-green: gate gọi ĐÚNG cặp engine (view/approve : leave), KHÔNG hard-code true.
 *
 * BẤT BIẾN: useCan gate KHÔNG hard-code role. reject:leave sensitive ⇒ useCan('reject','leave') luôn
 * false ở FE (không allowlist) → nút reject dùng approve:leave làm UI-hint; BE ép reject:leave thật.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@mediaos/web-core", () => {
  // ApiError THẬT-thu-nhỏ: cùng class-ref mà component import ⇒ `instanceof` trong mapMutationError đúng.
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code = "ERR", message = "") {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    useCan: vi.fn(() => true),
    leaveApi: {
      listRequests: vi.fn(),
      approveRequest: vi.fn(),
      rejectRequest: vi.fn(),
      listTypes: vi.fn().mockResolvedValue([]),
    },
    leaveKeys: {
      all: ["leave"],
      requests: {
        list: (p?: unknown) => ["leave", "requests", "list", p],
        detail: (id: string) => ["leave", "requests", "detail", id],
      },
      types: { list: (p?: unknown) => ["leave", "types", "list", p] },
    },
    leaveInvalidation: {
      approve: (id: string) => [
        ["leave", "requests", "list"],
        ["leave", "requests", "detail", id],
      ],
      reject: (id: string) => [
        ["leave", "requests", "list"],
        ["leave", "requests", "detail", id],
      ],
    },
  };
});

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({
      title,
      description,
      children,
    }: {
      title: string;
      description?: string;
      children?: React.ReactNode;
    }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
    ),
  };
});

import { useCan, leaveApi, ApiError } from "@mediaos/web-core";
import { LeaveApprovalPage } from "./LeaveApprovalPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockListRequests = leaveApi.listRequests as ReturnType<typeof vi.fn>;
const mockApprove = leaveApi.approveRequest as ReturnType<typeof vi.fn>;
const mockReject = leaveApi.rejectRequest as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────────

const PENDING_ITEM = {
  id: "req-1",
  leaveTypeId: "lt-1",
  leaveTypeCode: "ANNUAL",
  leaveTypeName: "Nghỉ phép năm",
  startDate: "2026-07-10",
  endDate: "2026-07-11",
  durationType: "FullDay",
  totalDays: 2,
  totalHours: null,
  status: "Pending",
  reason: "Về quê",
  balanceEffectStatus: null,
  submittedAt: "2026-07-01T03:00:00.000Z",
  createdAt: "2026-07-01T02:50:00.000Z",
  requester: {
    userId: "u-1",
    employeeCode: "EMP001",
    fullName: "Nguyễn Văn A",
    department: "Kỹ thuật",
  },
  approvedBy: null,
  approvedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
};

const LIST_ONE = {
  items: [PENDING_ITEM],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

const LIST_EMPTY = {
  items: [],
  meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

// Manager persona: view:leave + approve:leave = true; reject:leave = false (sensitive, no allowlist).
function managerCan(action: string, resourceType: string): boolean {
  return resourceType === "leave" && (action === "view" || action === "approve");
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <LeaveApprovalPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

async function openDetailDialog() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Xem chi tiết" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockImplementation(managerCan);
  (leaveApi.listTypes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// ── Deny-path (a): view gate ──────────────────────────────────────────────────

describe("LeaveApprovalPage — gate view:leave", () => {
  it("(a) forbidden mềm + KHÔNG gọi listRequests khi view:leave=false", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());
    expect(screen.getAllByText(/không có quyền/i).length).toBeGreaterThan(0);
    expect(mockListRequests).not.toHaveBeenCalled();
  });

  it("anti-false-green: gate gọi ĐÚNG cặp view:leave và approve:leave (không hard-code true)", async () => {
    mockListRequests.mockResolvedValue(LIST_EMPTY);
    renderPage(buildQC());
    await waitFor(() => expect(mockListRequests).toHaveBeenCalled());
    expect(mockUseCan).toHaveBeenCalledWith("view", "leave");
    expect(mockUseCan).toHaveBeenCalledWith("approve", "leave");
  });
});

// ── Data states ────────────────────────────────────────────────────────────────

describe("LeaveApprovalPage — data states", () => {
  it("empty state khi không có đơn chờ duyệt", async () => {
    mockListRequests.mockResolvedValue(LIST_EMPTY);
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không có đơn cần duyệt/i)).toBeTruthy());
  });

  it("error state khi listRequests lỗi", async () => {
    mockListRequests.mockRejectedValue(new Error("network"));
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText(/không thể tải danh sách/i)).toBeTruthy());
  });

  it("render dòng đơn: requester + loại nghỉ + trạng thái", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    renderPage(buildQC());
    await waitFor(() => expect(screen.getByText("Nguyễn Văn A")).toBeTruthy());
    expect(screen.getByText("Nghỉ phép năm")).toBeTruthy();
  });
});

// ── Deny-path (b): approve gate hides both action buttons ─────────────────────

describe("LeaveApprovalPage — gate approve:leave (nút hành động)", () => {
  it("(b) approve:leave=false → nút approve + reject KHÔNG render trong detail dialog", async () => {
    mockUseCan.mockImplementation((a, r) => r === "leave" && a === "view"); // view only
    mockListRequests.mockResolvedValue(LIST_ONE);
    renderPage(buildQC());
    await openDetailDialog();
    expect(screen.queryByTestId("btn-open-approve")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-open-reject")).not.toBeInTheDocument();
  });

  it("manager (approve:leave=true) → hiện cả nút Duyệt và Từ chối", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    renderPage(buildQC());
    await openDetailDialog();
    expect(screen.getByTestId("btn-open-approve")).toBeInTheDocument();
    expect(screen.getByTestId("btn-open-reject")).toBeInTheDocument();
  });
});

// ── Reject reason bắt buộc ─────────────────────────────────────────────────────

describe("LeaveApprovalPage — reject reason bắt buộc", () => {
  it("submit reject khi reason rỗng → KHÔNG gọi rejectRequest + hiện lỗi validation", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    renderPage(buildQC());
    await openDetailDialog();
    fireEvent.click(screen.getByTestId("btn-open-reject"));
    await waitFor(() => expect(screen.getByTestId("btn-confirm-reject")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("btn-confirm-reject"));
    expect(mockReject).not.toHaveBeenCalled();
    expect(screen.getByText(/lý do từ chối là bắt buộc/i)).toBeTruthy();
  });
});

// ── Deny-path (c): reject 403 (sensitive, fail-closed at BE) ────────────────────

describe("LeaveApprovalPage — reject 403 fail-closed", () => {
  it("(c) reject 403 → lỗi mềm, KHÔNG crash, list KHÔNG optimistic-apply", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    mockReject.mockRejectedValue(new ApiError(403, "FORBIDDEN", "no reject"));
    renderPage(buildQC());
    await openDetailDialog();
    fireEvent.click(screen.getByTestId("btn-open-reject"));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Không hợp lệ" } });
    fireEvent.click(screen.getByTestId("btn-confirm-reject"));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith("req-1", "Không hợp lệ"));
    // lỗi mềm (forbidden) hiển thị; dialog vẫn mở (không optimistic đóng), không throw.
    await waitFor(() => expect(screen.getByText(/không có quyền từ chối/i)).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ── Deny-path (d): approve 403 (outside scope) ─────────────────────────────────

describe("LeaveApprovalPage — approve 403 outside scope", () => {
  it("(d) approve 403 → lỗi mềm, dialog vẫn mở, không crash", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    mockApprove.mockRejectedValue(new ApiError(403, "FORBIDDEN", "outside scope"));
    renderPage(buildQC());
    await openDetailDialog();
    fireEvent.click(screen.getByTestId("btn-open-approve"));
    await waitFor(() => expect(screen.getByTestId("btn-confirm-approve")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("btn-confirm-approve"));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("req-1", undefined));
    await waitFor(() => expect(screen.getByText(/không có quyền duyệt/i)).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ── QA-05 happy-path: approve success ──────────────────────────────────────────

describe("LeaveApprovalPage — QA-05 approval flow smoke", () => {
  it("manager duyệt 1 đơn Pending → approveRequest gọi, dialog đóng, list invalidate (refetch)", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    mockApprove.mockResolvedValue({ id: "req-1", status: "Approved" });
    const qc = buildQC();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderPage(qc);
    await openDetailDialog();
    fireEvent.click(screen.getByTestId("btn-open-approve"));
    await waitFor(() => expect(screen.getByTestId("btn-confirm-approve")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("btn-confirm-approve"));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(1));
    // dialog đóng sau success
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // list-prefix được invalidate (refetch) — KHÔNG có balances.all trong tập key
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["leave", "requests", "list"],
    });
  });

  it("reject với lý do hợp lệ → rejectRequest gọi, dialog đóng", async () => {
    mockListRequests.mockResolvedValue(LIST_ONE);
    mockReject.mockResolvedValue({ id: "req-1", status: "Rejected" });
    renderPage(buildQC());
    await openDetailDialog();
    fireEvent.click(screen.getByTestId("btn-open-reject"));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Trùng lịch nghỉ nhóm" } });
    fireEvent.click(screen.getByTestId("btn-confirm-reject"));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith("req-1", "Trùng lịch nghỉ nhóm"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
