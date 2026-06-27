import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Render-smoke (QA-02 matrix) — NotificationBell: mount không throw.
 * Stub @mediaos/web-core (notificationApi) + react-i18next để test
 * độc lập khỏi network/auth. Panel dropdown KHÔNG mở trong smoke này.
 */

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...mod,
    notificationApi: {
      unreadCount: vi.fn().mockResolvedValue({ count: 0 }),
      list: vi.fn().mockResolvedValue([]),
      markRead: vi.fn().mockResolvedValue(undefined),
      markAllRead: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => {
      const map: Record<string, string> = {
        ariaLabel: "Thông báo",
        title: "Thông báo",
        markAllRead: "Đánh dấu tất cả đã đọc",
        empty: "Không có thông báo",
      };
      return map[k] ?? k;
    },
  }),
}));

import { NotificationBell } from "./notification-bell";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("NotificationBell", () => {
  it("render được nút chuông (mount không throw)", () => {
    render(<NotificationBell />, { wrapper });
    expect(screen.getByRole("button", { name: "Thông báo" })).toBeInTheDocument();
  });

  it("không hiển thị badge khi unread = 0", () => {
    render(<NotificationBell />, { wrapper });
    // Badge chứa số đếm không hiển thị khi count=0
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
