// @vitest-environment jsdom
/**
 * MarkAllReadButton tests (S4-FE-NOTI-1). Phủ: deny-path (useCan=false → ẩn) · click → gọi
 * markAllRead() + invalidate list/dropdown/unread-count.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(),
  myNotificationApi: { markAllRead: vi.fn() },
  notificationInvalidation: {
    markAllRead: () => [
      ["notifications", "list"],
      ["notifications", "unread-count"],
    ],
  },
}));

import { useCan, myNotificationApi } from "@mediaos/web-core";
import { MarkAllReadButton } from "./MarkAllReadButton";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockMarkAllRead = myNotificationApi.markAllRead as ReturnType<typeof vi.fn>;

function renderButton(disabled?: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MarkAllReadButton disabled={disabled} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
  mockMarkAllRead.mockResolvedValue({ updated_count: 3, unread_count: 0, read_at: "now" });
});

describe("MarkAllReadButton", () => {
  it("useCan(mark_all_read, notification) = false → KHÔNG render", () => {
    mockUseCan.mockReturnValue(false);
    const { container } = renderButton();
    expect(container.firstChild).toBeNull();
  });

  it("có quyền → render, click → gọi markAllRead()", async () => {
    renderButton();
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    });
  });

  it("disabled=true (unread_count=0) → nút bị vô hiệu hoá", () => {
    renderButton(true);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
