import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Partial-mock @mediaos/web-core: giữ NGUYÊN i18n/registerI18nResources/ApiError (test/setup dùng để init
// chuỗi vi), chỉ thay twoFactorApi bằng stub điều khiển được. KHÔNG mock cả module (sẽ phá i18n singleton).
// vi.hoisted: factory vi.mock bị hoist lên đầu file → biến phải tạo trong hoisted block mới truy cập được.
const { status, enroll, enable, disable } = vi.hoisted(() => ({
  status: vi.fn(),
  enroll: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, twoFactorApi: { status, enroll, enable, disable } };
});

import { TwoFactorSettings } from "./TwoFactorSettings";

afterEach(() => vi.clearAllMocks());

describe("TwoFactorSettings", () => {
  it("offers to enable 2FA when it is currently disabled", async () => {
    status.mockResolvedValue({ enabled: false, required: false });
    render(<TwoFactorSettings />);
    expect(await screen.findByRole("button", { name: "Bật 2FA" })).toBeInTheDocument();
  });

  it("offers to disable 2FA when it is currently enabled", async () => {
    status.mockResolvedValue({ enabled: true, required: false });
    render(<TwoFactorSettings />);
    expect(await screen.findByRole("button", { name: "Tắt 2FA" })).toBeInTheDocument();
  });

  it("surfaces a retry affordance when loading the status fails", async () => {
    status.mockRejectedValue(new Error("network down"));
    render(<TwoFactorSettings />);
    expect(await screen.findByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("opens the enroll dialog with the one-time recovery codes when enabling", async () => {
    status.mockResolvedValue({ enabled: false, required: false });
    enroll.mockResolvedValue({
      otpauthUri: "otpauth://totp/FUNTIME%20MEDIA:user?secret=ABCDEF",
      recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"],
    });
    render(<TwoFactorSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Bật 2FA" }));

    // enroll() được gọi, recovery codes hiện trong modal (đường đi rủi ro nhất của feature đã-live).
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("AAAA-BBBB")).toBeInTheDocument();
    expect(screen.getByText("CCCC-DDDD")).toBeInTheDocument();
  });
});
