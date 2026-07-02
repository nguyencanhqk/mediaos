// @vitest-environment jsdom
/**
 * [deny-path] HealthPage — S2-FE-FND-4.
 *
 * Gate: BE HealthController @Public() (KHÔNG cặp permission seed) → FE dùng baseline "khu vực quản trị hệ
 * thống" (view:foundation-setting OR view:user, giống system.overview — xem constants.ts). Test ở đây
 * assert FE-side gate: thiếu CẢ HAI → forbidden + KHÔNG gọi getHealth/getHealthDb.
 *
 * States: forbidden · ok (cả 2 probe) · down (probe lỗi).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  getHealth: vi.fn(),
  getHealthDb: vi.fn(),
  rootKeys: { foundation: ["foundation"] },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {actions}
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
  };
});

import { useCan, getHealth, getHealthDb } from "@mediaos/web-core";
import { HealthPage } from "./HealthPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockGetHealth = getHealth as ReturnType<typeof vi.fn>;
const mockGetHealthDb = getHealthDb as ReturnType<typeof vi.fn>;

function buildQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <HealthPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HealthPage", () => {
  it("[deny] no baseline permission at all → forbidden, getHealth/getHealthDb NOT called", () => {
    mockUseCan.mockReturnValue(false);
    renderPage(buildQC());

    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetHealth).not.toHaveBeenCalled();
    expect(mockGetHealthDb).not.toHaveBeenCalled();
  });

  it("has baseline permission → renders OK status for both probes", async () => {
    mockUseCan.mockReturnValue(true);
    mockGetHealth.mockResolvedValue({
      status: "ok",
      service: "mediaos-api",
      time: "2026-07-02T00:00:00Z",
    });
    mockGetHealthDb.mockResolvedValue({ status: "ok", database: { ok: true, latencyMs: 5 } });

    renderPage(buildQC());

    await waitFor(() => expect(mockGetHealth).toHaveBeenCalled());
    await waitFor(() => expect(mockGetHealthDb).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByText(/hoạt động bình thường/i).length).toBeGreaterThan(0),
    );
  });

  it("DB probe down → shows down status independently of API probe", async () => {
    mockUseCan.mockReturnValue(true);
    mockGetHealth.mockResolvedValue({ status: "ok", service: "mediaos-api" });
    mockGetHealthDb.mockResolvedValue({
      status: "down",
      database: { ok: false, error: "timeout" },
    });

    renderPage(buildQC());

    await waitFor(() => expect(mockGetHealthDb).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/không hoạt động/i)).toBeInTheDocument());
  });
});
