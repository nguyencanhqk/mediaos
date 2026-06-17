import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { TenantAuditPage } from "./tenant-audit";
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<TenantAuditPage />, { wrapper });
}

const okEnvelope = (data: unknown) => ({ success: true, data, error: null });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AC-8 TenantAuditPage (PermissionGate view:audit-log)", () => {
  it("KHÔNG có view:audit-log → noPermission (ẩn bảng)", () => {
    setCaps({});
    renderPage();
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
    expect(screen.queryByText("Nhật ký kiểm toán")).not.toBeInTheDocument();
  });

  it("có view:audit-log + empty → EmptyState", async () => {
    setCaps({ "view:audit-log": true });
    stubFetch({ ok: true, status: 200, body: okEnvelope({ data: [], meta: { total: 0, limit: 25, offset: 0 } }) });
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có nhật ký")).toBeInTheDocument());
  });

  it("KHÔNG hiển thị ô lọc companyId (tenant chỉ thấy tenant mình)", async () => {
    setCaps({ "view:audit-log": true });
    stubFetch({ ok: true, status: 200, body: okEnvelope({ data: [], meta: { total: 0, limit: 25, offset: 0 } }) });
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có nhật ký")).toBeInTheDocument());
    expect(screen.queryByText("Mã công ty (operator)")).not.toBeInTheDocument();
  });

  it("có quyền + lỗi → role=alert", async () => {
    setCaps({ "view:audit-log": true });
    stubFetch({ ok: false, status: 500, body: { success: false, data: null, error: { code: "x", message: "boom" } } });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
