/**
 * SeedsPage — S2-FE-FND-5 (lane FE batch C). Trạng thái seed, chỉ đọc.
 * Gate: view:foundation-seed (is_sensitive=true, System scope) — useCanExact (KHÔNG wildcard kế thừa).
 * States: forbidden · loading · error · empty · list.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, foundationOpsApi } from "@mediaos/web-core";
import { SeedsPage } from "./SeedsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    foundationOpsApi: {
      listSequences: vi.fn(),
      previewSequence: vi.fn(),
      updateSequence: vi.fn(),
      listSeeds: vi.fn(),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

const BATCH = {
  id: "batch-1",
  seedKey: "hr-master-data",
  seedVersion: "1.0.0",
  environment: "production",
  status: "Success" as const,
  checksum: "abc123",
  startedAt: "2026-07-01T00:00:00.000Z",
  finishedAt: "2026-07-01T00:05:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:05:00.000Z",
};

describe("SeedsPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    vi.mocked(foundationOpsApi.listSeeds).mockResolvedValue([BATCH]);
  });

  // ── DENY-PATH: wildcard KHÔNG mở khoá cặp sensitive (useCanExact) ─────────
  it("shows forbidden even with wildcard '*:*' (view:foundation-seed is sensitive)", () => {
    setCaps({ "*:*": true });
    renderWithQuery(<SeedsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(foundationOpsApi.listSeeds).not.toHaveBeenCalled();
  });

  it("renders seed batch list", async () => {
    setCaps({ "view:foundation-seed": true });
    renderWithQuery(<SeedsPage />);
    await waitFor(() => expect(screen.getByText("hr-master-data")).toBeInTheDocument());
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Thành công")).toBeInTheDocument();
  });

  it("shows error state on failure", async () => {
    setCaps({ "view:foundation-seed": true });
    vi.mocked(foundationOpsApi.listSeeds).mockRejectedValue(new Error("net"));
    renderWithQuery(<SeedsPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải trạng thái seed/i)).toBeInTheDocument(),
    );
  });

  it("shows empty state when there are no seed batches", async () => {
    setCaps({ "view:foundation-seed": true });
    vi.mocked(foundationOpsApi.listSeeds).mockResolvedValue([]);
    renderWithQuery(<SeedsPage />);
    await waitFor(() => expect(screen.getByText(/không có dữ liệu seed/i)).toBeInTheDocument());
  });
});
