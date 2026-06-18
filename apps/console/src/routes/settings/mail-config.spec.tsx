import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MailConfigDto } from "@mediaos/contracts";
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
    fireEvent.change(screen.getByPlaceholderText("smtp.example.com"), { target: { value: "smtp.x.com" } });
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
    fireEvent.change(screen.getByPlaceholderText("smtp.example.com"), { target: { value: "smtp.x.com" } });
    fireEvent.change(screen.getAllByPlaceholderText("noreply@example.com")[0], { target: { value: "u@x.com" } });
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
    render(<MailConfigForm initial={makeConfig()} scopeTab="default" onSubmit={vi.fn()} runTest={runTest} />);
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra kết nối/i }));
    await waitFor(() => expect(screen.getByText(/Kết nối SMTP thành công/i)).toBeInTheDocument());
    expect(runTest).toHaveBeenCalledOnce();
  });

  it("test thất bại → hiện errorMessage server trả (đã sanitize), KHÔNG lộ credential", async () => {
    const runTest = vi.fn().mockResolvedValue({ ok: false, errorMessage: "Xác thực SMTP thất bại" });
    render(<MailConfigForm initial={makeConfig()} scopeTab="default" onSubmit={vi.fn()} runTest={runTest} />);
    fireEvent.click(screen.getByRole("button", { name: /Kiểm tra kết nối/i }));
    await waitFor(() => expect(screen.getByText("Xác thực SMTP thất bại")).toBeInTheDocument());
  });
});
