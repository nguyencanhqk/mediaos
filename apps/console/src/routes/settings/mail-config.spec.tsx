import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MailConfigDto } from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import { MailConfigForm } from "./mail-config";

function makeConfig(over: Partial<MailConfigDto> = {}): MailConfigDto {
  return {
    scope: "default",
    host: "smtp.example.com",
    port: 587,
    username: "noreply@example.com",
    secure: true,
    fromName: "Funtime",
    fromEmail: "noreply@example.com",
    hasPassword: true,
    updatedAt: new Date("2026-06-18T00:00:00.000Z").toISOString(),
    ...over,
  };
}

describe("MailConfigForm — empty-state", () => {
  it("chưa thiết lập (initial=null) → hiện empty-state + nút Thiết lập (chưa render form)", () => {
    render(<MailConfigForm initial={null} scopeTab="default" onSubmit={vi.fn()} />);
    expect(screen.getByText(/Chưa thiết lập máy chủ SMTP/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("smtp.example.com")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Thiết lập/i }));
    expect(screen.getByPlaceholderText("smtp.example.com")).toBeInTheDocument();
  });
});

describe("MailConfigForm — KHÔNG prefill password (secret không tới client)", () => {
  it("ô mật khẩu rỗng dù hasPassword=true; có hint giữ mật khẩu", () => {
    render(<MailConfigForm initial={makeConfig()} scopeTab="default" onSubmit={vi.fn()} />);
    const pwInput = screen.getByPlaceholderText(/Để trống để giữ/i) as HTMLInputElement;
    expect(pwInput.value).toBe("");
    expect(pwInput.type).toBe("password");
  });
});

describe("MailConfigForm — submit", () => {
  it("cập nhật KHÔNG nhập password → payload KHÔNG có password (giữ envelope cũ)", () => {
    const onSubmit = vi.fn();
    render(<MailConfigForm initial={makeConfig()} scopeTab="default" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Lưu cấu hình/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.password).toBeUndefined();
    expect(payload.host).toBe("smtp.example.com");
  });

  it("tạo MỚI mà thiếu password → lỗi 'yêu cầu mật khẩu', KHÔNG submit", () => {
    const onSubmit = vi.fn();
    render(<MailConfigForm initial={null} scopeTab="default" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Thiết lập/i }));
    fireEvent.change(screen.getByPlaceholderText("smtp.example.com"), {
      target: { value: "smtp.x.com" },
    });
    const emails = screen.getAllByPlaceholderText("noreply@example.com");
    fireEvent.change(emails[0], { target: { value: "u@x.com" } }); // username
    fireEvent.change(emails[emails.length - 1], { target: { value: "from@x.com" } }); // fromEmail
    fireEvent.click(screen.getByRole("button", { name: /Lưu cấu hình/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/yêu cầu mật khẩu/i);
  });

  it("tạo MỚI có password → submit payload có password", () => {
    const onSubmit = vi.fn();
    render(<MailConfigForm initial={null} scopeTab="default" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Thiết lập/i }));
    fireEvent.change(screen.getByPlaceholderText("smtp.example.com"), {
      target: { value: "smtp.x.com" },
    });
    fireEvent.change(screen.getAllByPlaceholderText("noreply@example.com")[0], {
      target: { value: "u@x.com" },
    });
    // fromEmail (ô email thứ 2)
    const emails = screen.getAllByPlaceholderText("noreply@example.com");
    fireEvent.change(emails[emails.length - 1], { target: { value: "from@x.com" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret-pw" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu cấu hình/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].password).toBe("secret-pw");
  });
});

describe("MailConfigForm — test connection hiển thị kết quả ĐÃ sanitize", () => {
  it("test thành công → hiện thông báo thành công", async () => {
    const runTest = vi.fn().mockResolvedValue({ ok: true });
    render(
      <MailConfigForm
        initial={makeConfig()}
        scopeTab="default"
        onSubmit={vi.fn()}
        runTest={runTest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra kết nối/i }));
    await waitFor(() => expect(screen.getByText(/Kết nối SMTP thành công/i)).toBeInTheDocument());
    expect(runTest).toHaveBeenCalledOnce();
  });

  it("test thất bại → hiện errorMessage server trả (đã sanitize), KHÔNG lộ credential", async () => {
    const runTest = vi
      .fn()
      .mockResolvedValue({ ok: false, errorMessage: "Xác thực SMTP thất bại" });
    render(
      <MailConfigForm
        initial={makeConfig()}
        scopeTab="default"
        onSubmit={vi.fn()}
        runTest={runTest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra kết nối/i }));
    await waitFor(() => expect(screen.getByText("Xác thực SMTP thất bại")).toBeInTheDocument());
  });
});

// S19-SEC-MAILCREDEXFIL-1 — mật khẩu đã lưu chỉ dùng được cho ĐÚNG đích đã lưu. Đổi máy chủ/cổng/tên
// đăng nhập/TLS mà không nhập lại mật khẩu ⇒ FE chặn sớm (server vẫn là nguồn sự thật: 400 mã riêng).
const MAIL_PASSWORD_REQUIRED = "FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED";
const REENTER_PW = /nhập lại mật khẩu/i;

describe("MailConfigForm — đổi đích BẮT nhập lại mật khẩu", () => {
  const changeHost = () =>
    fireEvent.change(screen.getByPlaceholderText("smtp.example.com"), {
      target: { value: "smtp.attacker.example" },
    });

  it.each([
    ["host", () => changeHost()],
    [
      "cổng",
      () => fireEvent.change(screen.getByDisplayValue("587"), { target: { value: "2525" } }),
    ],
    [
      "tên đăng nhập",
      () =>
        fireEvent.change(screen.getAllByPlaceholderText("noreply@example.com")[0], {
          target: { value: "other@example.com" },
        }),
    ],
    ["TLS", () => fireEvent.click(screen.getByRole("checkbox"))],
  ])("đổi %s, ô mật khẩu trống → Lưu bị chặn + thông báo, KHÔNG submit", (_label, mutate) => {
    const onSubmit = vi.fn();
    render(<MailConfigForm initial={makeConfig()} scopeTab="default" onSubmit={onSubmit} />);
    mutate();
    fireEvent.click(screen.getByRole("button", { name: /Lưu cấu hình/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(REENTER_PW);
  });

  it("đổi host, ô mật khẩu trống → Kiểm tra kết nối bị chặn, KHÔNG gọi runTest", async () => {
    const runTest = vi.fn().mockResolvedValue({ ok: true });
    render(
      <MailConfigForm
        initial={makeConfig()}
        scopeTab="default"
        onSubmit={vi.fn()}
        runTest={runTest}
      />,
    );
    changeHost();
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra kết nối/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(REENTER_PW));
    expect(runTest).not.toHaveBeenCalled();
  });

  it("đổi host CÓ nhập mật khẩu → submit payload mang password mới", () => {
    const onSubmit = vi.fn();
    render(<MailConfigForm initial={makeConfig()} scopeTab="default" onSubmit={onSubmit} />);
    changeHost();
    fireEvent.change(screen.getByPlaceholderText(/Để trống để giữ/i), {
      target: { value: "new-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lưu cấu hình/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      host: "smtp.attacker.example",
      password: "new-pw",
    });
  });

  it("CHỈ đổi tên người gửi → vẫn lưu được mà không cần mật khẩu", () => {
    const onSubmit = vi.fn();
    render(<MailConfigForm initial={makeConfig()} scopeTab="default" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByDisplayValue("Funtime"), { target: { value: "Phòng Nhân sự" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu cấu hình/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].password).toBeUndefined();
  });

  it("server trả 400 mã MAIL-PASSWORD-REQUIRED khi lưu → hiện thông báo nhập lại mật khẩu", () => {
    const saveError = new ApiError(400, MAIL_PASSWORD_REQUIRED, "server message");
    render(
      <MailConfigForm
        initial={makeConfig()}
        scopeTab="default"
        onSubmit={vi.fn()}
        isSaveError
        saveError={saveError}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(REENTER_PW);
  });

  it("runTest ném 400 mã MAIL-PASSWORD-REQUIRED → hiện thông báo nhập lại mật khẩu", async () => {
    const runTest = vi.fn().mockRejectedValue(new ApiError(400, MAIL_PASSWORD_REQUIRED, "x"));
    render(
      <MailConfigForm
        initial={makeConfig()}
        scopeTab="default"
        onSubmit={vi.fn()}
        runTest={runTest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra kết nối/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(REENTER_PW));
  });
});

// FULL gate silent-failure L-3 / L-5.
describe("MailConfigForm — lỗi không lẫn vào nhau", () => {
  it("cổng trống + ô mật khẩu trống → báo lỗi CỔNG, không báo nhầm 'đã đổi đích'", () => {
    const onSubmit = vi.fn();
    render(<MailConfigForm initial={makeConfig()} scopeTab="default" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByDisplayValue("587"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu cấu hình/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/port/i);
    expect(alert).not.toHaveTextContent(REENTER_PW);
  });

  it("request kiểm tra KHÔNG tới được bước SMTP (mạng/phiên/500) → câu riêng, KHÁC 'Kiểm tra kết nối thất bại.'", async () => {
    const runTest = vi.fn().mockRejectedValue(new ApiError(500, "SYSTEM-ERR-001", "boom"));
    render(
      <MailConfigForm
        initial={makeConfig()}
        scopeTab="default"
        onSubmit={vi.fn()}
        runTest={runTest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra kết nối/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/Không gửi được yêu cầu kiểm tra/),
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("Kiểm tra kết nối thất bại.");
  });

  it("Kiểm tra bị server đòi mật khẩu → gọi onPasswordRequired (container tải lại đích mới)", async () => {
    const onPasswordRequired = vi.fn();
    const runTest = vi.fn().mockRejectedValue(new ApiError(400, MAIL_PASSWORD_REQUIRED, "x"));
    render(
      <MailConfigForm
        initial={makeConfig()}
        scopeTab="default"
        onSubmit={vi.fn()}
        runTest={runTest}
        onPasswordRequired={onPasswordRequired}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra kết nối/i }));
    await waitFor(() => expect(onPasswordRequired).toHaveBeenCalledOnce());
  });
});
