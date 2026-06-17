import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModulesListPage } from "./modules-list";
import { useAuthStore } from "@/stores/auth";

// useParams trả companyId cố định (route /tenant/:companyId/modules).
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ companyId: "22222222-2222-2222-2222-222222222222" }),
}));

interface MockRes {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
}

function stubFetch(res: MockRes) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => res.text ?? JSON.stringify(res.body ?? ""),
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
  return render(<ModulesListPage />, { wrapper });
}

const moduleRow = {
  id: "11111111-1111-1111-1111-111111111111",
  key: "analytics",
  name: "Phân tích nâng cao",
  description: "Báo cáo nâng cao",
  icon: "bar-chart",
  route: "/analytics",
  featureKeys: ["advanced_analytics"],
  dependsOn: [],
  displayOrder: 0,
  isActive: true,
  createdAt: "2026-06-17T00:00:00.000Z",
  updatedAt: "2026-06-17T00:00:00.000Z",
  enabled: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe("ModulesListPage", () => {
  it("hiển thị tiêu đề trang", async () => {
    setCaps({ "view:system-module": true });
    stubFetch({ ok: true, status: 200, body: [] });
    renderPage();
    expect(screen.getByRole("heading", { name: "Module hệ thống" })).toBeInTheDocument();
  });

  it("render dòng module + trạng thái khi load xong", async () => {
    setCaps({ "view:system-module": true });
    stubFetch({ ok: true, status: 200, body: [moduleRow] });
    renderPage();
    await waitFor(() => expect(screen.getByText("Phân tích nâng cao")).toBeInTheDocument());
    expect(screen.getByText("analytics")).toBeInTheDocument();
    expect(screen.getByText("Đang tắt")).toBeInTheDocument();
  });

  it("hiển thị empty state khi không có module", async () => {
    setCaps({ "view:system-module": true });
    stubFetch({ ok: true, status: 200, body: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có module nào")).toBeInTheDocument());
  });

  it("hiển thị error + nút thử lại khi load lỗi (deny/500)", async () => {
    setCaps({ "view:system-module": true });
    stubFetch({
      ok: false,
      status: 403,
      text: JSON.stringify({ error: { code: "FORBIDDEN", message: "no" } }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Không tải được danh sách module.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("ẨN nút Bật/Tắt khi thiếu manage:module-toggle (permission-gated)", async () => {
    setCaps({ "view:system-module": true });
    stubFetch({ ok: true, status: 200, body: [moduleRow] });
    renderPage();
    await waitFor(() => expect(screen.getByText("Phân tích nâng cao")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Bật" })).not.toBeInTheDocument();
  });

  it("HIỆN nút Bật cho module đang tắt khi có manage:module-toggle", async () => {
    setCaps({ "view:system-module": true, "manage:module-toggle": true });
    stubFetch({ ok: true, status: 200, body: [moduleRow] });
    renderPage();
    await waitFor(() => expect(screen.getByText("Phân tích nâng cao")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Bật" })).toBeInTheDocument();
  });

  it("HIỆN nút Tắt cho module đang bật", async () => {
    setCaps({ "view:system-module": true, "manage:module-toggle": true });
    stubFetch({ ok: true, status: 200, body: [{ ...moduleRow, enabled: true }] });
    renderPage();
    await waitFor(() => expect(screen.getByText("Đang bật")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Tắt" })).toBeInTheDocument();
  });
});
