// @vitest-environment jsdom
/**
 * MarkReadButton tests (S4-FE-NOTI-1). Phủ: deny-path (useCan=false → ẩn) · status!==Unread → ẩn
 * (idempotent-UI) · click → gọi markRead(id) + invalidate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(),
  myNotificationApi: { markRead: vi.fn() },
  notificationInvalidation: {
    markRead: (id: string) => [
      ["notifications", "list"],
      ["notifications", "detail", id],
    ],
  },
}));

import { useCan, myNotificationApi } from "@mediaos/web-core";
import { MarkReadButton } from "./MarkReadButton";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockMarkRead = myNotificationApi.markRead as ReturnType<typeof vi.fn>;

function renderButton(status = "Unread") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MarkReadButton notificationId="n1" status={status} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(true);
  mockMarkRead.mockResolvedValue({ notification_id: "n1", status: "Read", read_at: "now" });
});

describe("MarkReadButton", () => {
  it("useCan(mark_read, notification) = false → KHÔNG render", () => {
    mockUseCan.mockReturnValue(false);
    const { container } = renderButton();
    expect(container.firstChild).toBeNull();
  });

  it("status='Read' → KHÔNG render (idempotent UI, KHÔNG cho bấm lại vô nghĩa)", () => {
    const { container } = renderButton("Read");
    expect(container.firstChild).toBeNull();
  });

  it("status='Unread' + có quyền → render, click → gọi markRead('n1')", async () => {
    renderButton("Unread");
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith("n1");
    });
  });
});
