// @vitest-environment jsdom
/**
 * MeTrainingCard tests (S5-LMS-FE-1). Phủ: SELF-GATE access:lms (thiếu quyền → render null + KHÔNG gọi
 * meApi.getTraining) · loading · ok (số khoá + khoá gần nhất + progressbar) · no_account (empty fail-soft)
 * · lỗi 502/transport (fail-soft + thử lại gọi lại API). Card có QUERY RIÊNG — KHÔNG phụ thuộc getOverview.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import type { MeTrainingResponse } from "@mediaos/contracts";
import i18n from "@/i18n";
import { MeTrainingCard } from "./MeTrainingCard";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, meApi: { getTraining: vi.fn() } };
});

import { meApi } from "@mediaos/web-core";
const mockGetTraining = meApi.getTraining as ReturnType<typeof vi.fn>;

const OK_RESPONSE: MeTrainingResponse = {
  status: "ok",
  progress: {
    version: 1,
    generatedAt: "2026-07-20T10:00:00.000Z",
    user: { email: "t@demo.local", name: "Trần Văn Test", active: true },
    summary: {
      courseCount: 3,
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
      submitted: 0,
      passed: 0,
      failed: 0,
      pendingGrading: 0,
      bestScore10: null,
      lastSubmittedAt: null,
      truncated: false,
    },
    quizzes: { submitted: 0, averagePercent: null, lastSubmittedAt: null },
  },
};

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

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MeTrainingCard />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("MeTrainingCard — gate access:lms", () => {
  it("thiếu access:lms → render null, KHÔNG gọi meApi.getTraining", () => {
    setCaps({ "access:me": true });
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(mockGetTraining).not.toHaveBeenCalled();
  });
});

describe("MeTrainingCard — data states (có access:lms)", () => {
  beforeEach(() => setCaps({ "access:lms": true }));

  it("ok → hiện số khoá + khoá gần nhất + progressbar; nút 'Xem chi tiết' điều hướng /me/training", async () => {
    mockGetTraining.mockResolvedValue(OK_RESPONSE);
    renderCard();
    // Tiêu đề card
    expect(screen.getByText("Đào tạo")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    // đang học = 3 - 1 = 2
    expect(screen.getByText(/2 đang học/)).toBeInTheDocument();
    expect(screen.getByText(/1 đã hoàn thành/)).toBeInTheDocument();
    // khoá gần nhất theo lastActivityAt = "Kỹ năng giao tiếp"
    expect(screen.getByText(/Kỹ năng giao tiếp/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "45");

    fireEvent.click(screen.getByText("Xem chi tiết"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/me/training" });
    expect(mockGetTraining).toHaveBeenCalledTimes(1);
  });

  it("no_account → empty fail-soft (chưa có tài khoản học), KHÔNG lỗi", async () => {
    mockGetTraining.mockResolvedValue({
      status: "no_account",
      progress: null,
    } satisfies MeTrainingResponse);
    renderCard();
    await waitFor(() => expect(screen.getByText(/chưa có tài khoản học/i)).toBeInTheDocument());
    expect(screen.queryByText(/không tải được/i)).not.toBeInTheDocument();
  });

  it("lỗi 502/transport → fail-soft error + thử lại gọi lại API", async () => {
    mockGetTraining.mockRejectedValue(new Error("502"));
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/không tải được tiến độ đào tạo/i)).toBeInTheDocument(),
    );
    mockGetTraining.mockClear();
    mockGetTraining.mockResolvedValue(OK_RESPONSE);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(mockGetTraining).toHaveBeenCalled());
  });
});
