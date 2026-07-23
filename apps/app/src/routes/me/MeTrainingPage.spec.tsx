// @vitest-environment jsdom
/**
 * MeTrainingPage tests (S5-LMS-FE-1, route /me/training). Phủ: gate access:lms (thiếu → forbidden, KHÔNG
 * gọi API) · loading skeleton · lỗi transport/502 + thử lại · empty (no_account) · ok (danh sách khoá +
 * tổng hợp + nút "Mở LMS" → /lms + banner tài khoản khoá). Page CHỈ đọc meApi.getTraining (1 nguồn).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeTrainingResponse } from "@mediaos/contracts";
import i18n from "@/i18n";
import { MeTrainingPage } from "./MeTrainingPage";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, meApi: { getTraining: vi.fn() } };
});

import { meApi } from "@mediaos/web-core";
const mockGetTraining = meApi.getTraining as ReturnType<typeof vi.fn>;

function okResponse(userActive = true): MeTrainingResponse {
  return {
    status: "ok",
    progress: {
      version: 1,
      generatedAt: "2026-07-20T10:00:00.000Z",
      user: { email: "t@demo.local", name: "Trần Văn Test", active: userActive },
      summary: {
        courseCount: 2,
        completedCourses: 1,
        learningTimeSec: 9000,
        lastActivityAt: "2026-07-19T08:00:00.000Z",
      },
      courses: [
        {
          slug: "atld",
          title: "An toàn lao động",
          percent: 100,
          completed: 10,
          total: 10,
          learningTimeSec: 3600,
          lastActivityAt: "2026-07-10T08:00:00.000Z",
        },
        {
          slug: "giao-tiep",
          title: "Kỹ năng giao tiếp",
          percent: 45,
          completed: 5,
          total: 11,
          learningTimeSec: 5400,
          lastActivityAt: "2026-07-19T08:00:00.000Z",
        },
      ],
      coursesTruncated: false,
      exams: {
        submitted: 2,
        passed: 1,
        failed: 1,
        pendingGrading: 0,
        bestScore10: 8.5,
        lastSubmittedAt: "2026-07-18T08:00:00.000Z",
        truncated: false,
      },
      quizzes: { submitted: 3, averagePercent: 72, lastSubmittedAt: "2026-07-17T08:00:00.000Z" },
    },
  };
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "t@demo.local",
      fullName: "Trần Văn Test",
      status: "Active",
      companyId: "co1",
    },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeTrainingPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MeTrainingPage — gate access:lms", () => {
  it("thiếu access:lms → forbidden, KHÔNG gọi meApi.getTraining", () => {
    setCaps({ "access:me": true });
    renderPage();
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(mockGetTraining).not.toHaveBeenCalled();
  });
});

describe("MeTrainingPage — data states (có access:lms)", () => {
  beforeEach(() => setCaps({ "access:lms": true }));

  it("loading → KHÔNG hiện danh sách khoá", () => {
    mockGetTraining.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText("An toàn lao động")).not.toBeInTheDocument();
  });

  it("lỗi transport/502 → error state + thử lại gọi lại API", async () => {
    mockGetTraining.mockRejectedValue(new Error("502"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/không tải được tiến độ đào tạo/i)).toBeInTheDocument(),
    );
    mockGetTraining.mockClear();
    mockGetTraining.mockResolvedValue(okResponse());
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetTraining).toHaveBeenCalled());
  });

  it("no_account → empty state (chưa có dữ liệu đào tạo)", async () => {
    mockGetTraining.mockResolvedValue({
      status: "no_account",
      progress: null,
    } satisfies MeTrainingResponse);
    renderPage();
    await waitFor(() => expect(screen.getByText(/chưa có dữ liệu đào tạo/i)).toBeInTheDocument());
  });

  it("ok → render danh sách khoá + tổng hợp + nút 'Mở LMS' điều hướng /lms", async () => {
    mockGetTraining.mockResolvedValue(okResponse());
    renderPage();
    await waitFor(() => expect(screen.getByText("An toàn lao động")).toBeInTheDocument());
    expect(screen.getByText("Kỹ năng giao tiếp")).toBeInTheDocument();
    // tổng hợp: 2 khoá học, 1 hoàn thành hiển thị trong StatCard
    expect(screen.getByText("Tiến độ đào tạo")).toBeInTheDocument();

    const openBtn = screen.getByRole("button", { name: /mở lms/i });
    fireEvent.click(openBtn);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/lms" });
    expect(mockGetTraining).toHaveBeenCalledTimes(1);
  });

  it("tài khoản LMS bị khoá (user.active=false) → hiện banner cảnh báo", async () => {
    mockGetTraining.mockResolvedValue(okResponse(false));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/tài khoản học của bạn đang bị khoá/i)).toBeInTheDocument(),
    );
  });
});
