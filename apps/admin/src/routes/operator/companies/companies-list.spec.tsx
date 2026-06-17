import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompaniesListPage } from "./companies-list";
import { useAuthStore } from "@/stores/auth";

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

/** Mỗi test 1 QueryClient mới (không retry → lỗi hiện ngay) + provider. */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<CompaniesListPage />, { wrapper });
}

const company = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Funtime Media",
  slug: "funtime-media",
  status: "active",
  timezone: "Asia/Ho_Chi_Minh",
  currency: "VND",
  language: "vi",
  createdAt: "2026-06-17T00:00:00.000Z",
  deletedAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe("CompaniesListPage", () => {
  it("hiển thị tiêu đề trang", async () => {
    setCaps({ "view:platform-company": true });
    stubFetch({ ok: true, status: 200, body: { items: [], total: 0, page: 1, limit: 20 } });
    renderPage();
    expect(screen.getByRole("heading", { name: "Công ty & Gói cước" })).toBeInTheDocument();
  });

  it("render dòng dữ liệu khi load xong", async () => {
    setCaps({ "view:platform-company": true });
    stubFetch({ ok: true, status: 200, body: { items: [company], total: 1, page: 1, limit: 20 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Funtime Media")).toBeInTheDocument());
    expect(screen.getByText("funtime-media")).toBeInTheDocument();
  });

  it("hiển thị empty state khi không có công ty", async () => {
    setCaps({ "view:platform-company": true });
    stubFetch({ ok: true, status: 200, body: { items: [], total: 0, page: 1, limit: 20 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Chưa có công ty nào")).toBeInTheDocument());
  });

  it("hiển thị error + nút thử lại khi load lỗi (deny/500)", async () => {
    setCaps({ "view:platform-company": true });
    stubFetch({
      ok: false,
      status: 403,
      text: JSON.stringify({ error: { code: "FORBIDDEN", message: "no" } }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Không tải được danh sách công ty.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("ẨN nút Tạo công ty khi thiếu manage:platform-company (permission-gated)", async () => {
    setCaps({ "view:platform-company": true });
    stubFetch({ ok: true, status: 200, body: { items: [company], total: 1, page: 1, limit: 20 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Funtime Media")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Tạo công ty/ })).not.toBeInTheDocument();
    // Không có quyền manage ⇒ không có nút Cấu hình / Đình chỉ trên row.
    expect(screen.queryByRole("button", { name: "Cấu hình" })).not.toBeInTheDocument();
  });

  it("HIỆN nút Tạo + hành động row khi có manage:platform-company", async () => {
    setCaps({ "view:platform-company": true, "manage:platform-company": true });
    stubFetch({ ok: true, status: 200, body: { items: [company], total: 1, page: 1, limit: 20 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Funtime Media")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /Tạo công ty/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cấu hình" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đình chỉ" })).toBeInTheDocument();
    // Thiếu manage:platform-subscription ⇒ KHÔNG có nút Đổi gói.
    expect(screen.queryByRole("button", { name: "Đổi gói" })).not.toBeInTheDocument();
  });

  it("HIỆN nút Đổi gói khi có manage:platform-subscription", async () => {
    setCaps({ "view:platform-company": true, "manage:platform-subscription": true });
    stubFetch({ ok: true, status: 200, body: { items: [company], total: 1, page: 1, limit: 20 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Funtime Media")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Đổi gói" })).toBeInTheDocument();
  });

  it("KHÔNG hiện nút Đình chỉ cho công ty đã suspended", async () => {
    setCaps({ "view:platform-company": true, "manage:platform-company": true });
    stubFetch({
      ok: true,
      status: 200,
      body: { items: [{ ...company, status: "suspended" }], total: 1, page: 1, limit: 20 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Funtime Media")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Đình chỉ" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cấu hình" })).toBeInTheDocument();
  });
});
