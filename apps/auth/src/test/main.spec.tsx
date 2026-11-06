import { describe, expect, it, vi } from "vitest";

/**
 * S20-FE-TOAST-2 — main.tsx gắn đích thông báo cho web-core lúc khởi động (thiếu ⇒ showApiErrorToast chỉ
 * rơi vào console). Chặn render thật: chỉ khoá dây nối khởi động.
 */
const { configureToast, renderSpy } = vi.hoisted(() => ({
  configureToast: vi.fn(),
  renderSpy: vi.fn(),
}));

vi.mock("@mediaos/web-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mediaos/web-core")>()),
  configureToast,
}));

vi.mock("react-dom/client", () => {
  const createRoot = () => ({ render: renderSpy, unmount: vi.fn() });
  return { createRoot, default: { createRoot } };
});

describe("apps/auth main — khởi động", () => {
  it("gọi configureToast(toast của @mediaos/ui) đúng một lần rồi mới render", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { toast } = await import("@mediaos/ui");

    await import("@/main");

    expect(configureToast).toHaveBeenCalledTimes(1);
    expect(configureToast).toHaveBeenCalledWith(toast);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});
