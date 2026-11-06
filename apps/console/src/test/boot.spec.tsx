import { describe, expect, it, vi } from "vitest";

/**
 * S20-FE-TOAST-2 — main.tsx gắn đích thông báo cho web-core lúc khởi động (thiếu ⇒ showApiErrorToast chỉ
 * rơi vào console). Không có phiên ⇒ không render; ca chỉ khoá dây nối khởi động.
 */
const { configureToast, bootstrapSession, redirectToAuth } = vi.hoisted(() => ({
  configureToast: vi.fn(),
  bootstrapSession: vi.fn(async () => false),
  redirectToAuth: vi.fn(),
}));

vi.mock("@mediaos/web-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mediaos/web-core")>()),
  configureToast,
  bootstrapSession,
  redirectToAuth,
}));

vi.mock("react-dom/client", () => {
  const createRoot = () => ({ render: vi.fn(), unmount: vi.fn() });
  return { createRoot, default: { createRoot } };
});

// Router kéo theo toàn bộ trang console — không cần cho dây nối khởi động.
vi.mock("@/router", () => ({ router: {} }));

describe("apps/console main — khởi động", () => {
  it("gọi configureToast(toast của @mediaos/ui) đúng một lần", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { toast } = await import("@mediaos/ui");

    await import("@/main");

    expect(configureToast).toHaveBeenCalledTimes(1);
    expect(configureToast).toHaveBeenCalledWith(toast);
  });
});
