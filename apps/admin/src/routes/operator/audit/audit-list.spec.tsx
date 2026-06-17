import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { OperatorAuditPage } from "./audit-list";
import { OperatorQueuePage } from "@/routes/operator/queue/queue-monitor";
import { useAuthStore } from "@/stores/auth";

function stubFetch(res: { ok: boolean; status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => JSON.stringify(res.body ?? ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

function renderPage(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(node, { wrapper });
}

const okEnvelope = (data: unknown) => ({ success: true, data, error: null });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AC-8 OperatorAuditPage (PermissionGate view:platform-audit)", () => {
  it("KHÔNG có view:platform-audit → ẩn bảng (hiện noPermission)", () => {
    setCaps({});
    renderPage(<OperatorAuditPage />);
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
    expect(screen.queryByText("Nhật ký kiểm toán toàn hệ thống")).not.toBeInTheDocument();
  });

  it("có view:platform-audit + empty → EmptyState", async () => {
    setCaps({ "view:platform-audit": true });
    stubFetch({ ok: true, status: 200, body: okEnvelope({ data: [], meta: { total: 0, limit: 25, offset: 0 } }) });
    renderPage(<OperatorAuditPage />);
    await waitFor(() => expect(screen.getByText("Chưa có nhật ký")).toBeInTheDocument());
  });

  it("có quyền + lỗi → role=alert", async () => {
    setCaps({ "view:platform-audit": true });
    stubFetch({ ok: false, status: 500, body: { success: false, data: null, error: { code: "x", message: "boom" } } });
    renderPage(<OperatorAuditPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("có quyền + data → render dòng audit", async () => {
    setCaps({ "view:platform-audit": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okEnvelope({
        data: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            companyId: "22222222-2222-2222-2222-222222222222",
            actorUserId: null,
            action: "TaskCreated",
            objectType: "task",
            objectId: null,
            before: null,
            after: { title: "x" },
            ip: null,
            userAgent: null,
            createdAt: "2026-06-17T00:00:00.000Z",
          },
        ],
        meta: { total: 1, limit: 25, offset: 0 },
      }),
    });
    renderPage(<OperatorAuditPage />);
    await waitFor(() => expect(screen.getByText("TaskCreated")).toBeInTheDocument());
  });

  it("redacted detail → hiển thị marker ẩn (không lộ payload)", async () => {
    setCaps({ "view:platform-audit": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okEnvelope({
        data: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            companyId: "22222222-2222-2222-2222-222222222222",
            actorUserId: null,
            action: "SalarySet",
            objectType: "salary_profile",
            objectId: null,
            before: null,
            after: { redacted: true },
            ip: null,
            userAgent: null,
            createdAt: "2026-06-17T00:00:00.000Z",
          },
        ],
        meta: { total: 1, limit: 25, offset: 0 },
      }),
    });
    renderPage(<OperatorAuditPage />);
    await waitFor(() => expect(screen.getByText("(đã ẩn — dữ liệu nhạy cảm)")).toBeInTheDocument());
  });
});

describe("AC-8 OperatorQueuePage (PermissionGate view:platform-audit)", () => {
  it("KHÔNG có view:platform-audit → noPermission", () => {
    setCaps({});
    renderPage(<OperatorQueuePage />);
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
  });

  it("có quyền + data → render counts + dead-letter", async () => {
    setCaps({ "view:platform-audit": true });
    stubFetch({
      ok: true,
      status: 200,
      body: okEnvelope({
        outbox: { counts: [{ status: "pending", count: 2 }], total: 2 },
        deadLetter: {
          unresolved: 1,
          total: 1,
          rows: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              companyId: "22222222-2222-2222-2222-222222222222",
              eventId: "33333333-3333-3333-3333-333333333333",
              consumerName: "webhook-fanout",
              eventType: "task.created",
              error: "timeout",
              createdAt: "2026-06-17T00:00:00.000Z",
              resolvedAt: null,
            },
          ],
        },
      }),
    });
    renderPage(<OperatorQueuePage />);
    await waitFor(() => expect(screen.getByText("webhook-fanout")).toBeInTheDocument());
  });

  it("có quyền + lỗi → role=alert", async () => {
    setCaps({ "view:platform-audit": true });
    stubFetch({ ok: false, status: 500, body: { success: false, data: null, error: { code: "x", message: "boom" } } });
    renderPage(<OperatorQueuePage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
