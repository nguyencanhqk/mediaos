// @vitest-environment jsdom
/**
 * WidgetCard tests (S4-FE-DASH-1) — shell dùng chung mọi widget dashboard.
 * Phủ: loading skeleton · error state (+ nút thử lại gọi onRefresh) · empty state · active (children) ·
 * quick action chỉ hiển thị NAVIGATE + enabled + target nội bộ an toàn (§16.4).
 */
import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { ListTodo } from "lucide-react";
import i18n from "@/i18n";
import { WidgetCard } from "./WidgetCard";
import type { QuickActionDto } from "@mediaos/contracts";

// NotificationTargetLink (quick action footer) gọi useNavigate() — mock để khỏi rỗng router context.
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

function renderCard(props: Partial<ComponentProps<typeof WidgetCard>> = {}) {
  const onRefresh = vi.fn();
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <WidgetCard
        title="Widget test"
        icon={ListTodo}
        isLoading={false}
        isError={false}
        isEmpty={false}
        emptyTitle="Trống"
        errorTitle="Lỗi"
        onRefresh={onRefresh}
        isRefreshing={false}
        {...props}
      >
        <p data-testid="active-body">Nội dung chính</p>
      </WidgetCard>
    </I18nextProvider>,
  );
  return { ...utils, onRefresh };
}

describe("WidgetCard — trạng thái", () => {
  it("isLoading=true → hiện skeleton, KHÔNG hiện children/empty/error", () => {
    renderCard({ isLoading: true });
    expect(screen.queryByTestId("active-body")).not.toBeInTheDocument();
    expect(screen.queryByText("Trống")).not.toBeInTheDocument();
  });

  it("isError=true → hiện errorTitle + nút thử lại gọi onRefresh", () => {
    const { onRefresh } = renderCard({ isError: true, errorTitle: "Không thể tải" });
    expect(screen.getByText("Không thể tải")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("isEmpty=true → hiện emptyTitle, KHÔNG hiện children", () => {
    renderCard({ isEmpty: true, emptyTitle: "Chưa có gì" });
    expect(screen.getByText("Chưa có gì")).toBeInTheDocument();
    expect(screen.queryByTestId("active-body")).not.toBeInTheDocument();
  });

  it("active (không loading/error/empty) → render children", () => {
    renderCard();
    expect(screen.getByTestId("active-body")).toBeInTheDocument();
  });

  it("nút Làm mới gọi onRefresh + disabled khi loading", () => {
    const { onRefresh, rerender } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /làm mới/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <I18nextProvider i18n={i18n}>
        <WidgetCard
          title="Widget test"
          icon={ListTodo}
          isLoading={true}
          isError={false}
          isEmpty={false}
          emptyTitle="Trống"
          errorTitle="Lỗi"
          onRefresh={onRefresh}
          isRefreshing={false}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("button", { name: /làm mới/i })).toBeDisabled();
  });
});

describe("WidgetCard — quick actions (§16.4: chỉ hiển thị nếu có quyền)", () => {
  const baseAction: QuickActionDto = {
    action_code: "OPEN_MY_TASKS",
    label: "Xem tất cả task",
    target_module: "TASK",
    method: "NAVIGATE",
    target_url: "/tasks/my",
    api_endpoint: null,
    enabled: true,
    disabled_reason: null,
  };

  it("action NAVIGATE + enabled + target an toàn → hiển thị", () => {
    renderCard({ quickActions: [baseAction] });
    expect(screen.getByText("Xem tất cả task")).toBeInTheDocument();
  });

  it("action disabled (enabled=false) → KHÔNG hiển thị", () => {
    renderCard({
      quickActions: [{ ...baseAction, enabled: false, disabled_reason: "Thiếu quyền read:task" }],
    });
    expect(screen.queryByText("Xem tất cả task")).not.toBeInTheDocument();
  });

  it("action method khác NAVIGATE (vd API_CALL) → KHÔNG hiển thị (P0 chỉ hỗ trợ NAVIGATE)", () => {
    renderCard({
      quickActions: [{ ...baseAction, method: "API_CALL", target_url: null, api_endpoint: "/x" }],
    });
    expect(screen.queryByText("Xem tất cả task")).not.toBeInTheDocument();
  });

  it("target_url external ('//evil.com') → KHÔNG hiển thị (chặn open-redirect)", () => {
    renderCard({ quickActions: [{ ...baseAction, target_url: "//evil.com" }] });
    expect(screen.queryByText("Xem tất cả task")).not.toBeInTheDocument();
  });
});
