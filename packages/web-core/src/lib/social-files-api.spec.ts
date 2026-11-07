/**
 * social-files-api.spec.ts — `uploadSocialAttachment` + `socialFilesApi` (S16-SOCIAL-FE-2D, plan §4 A2 ·
 * ca **W1–W6**): ba pha `054 upload-url` → PUT storage → `055 confirm`.
 *
 * Khuôn `social-kudos-api.spec.ts`: mock `apiFetch` để đọc path/body, RỒI chạy chính schema đã truyền vào
 * trên payload đúng hình dạng BE trả (`registerFileResponseSchema`/`confirmUploadResponseSchema` của
 * FOUNDATION — `social-files.service.ts`). Body gửi đi kiểm bằng CHÍNH schema `.strict()` của contracts.
 *
 * ⚠️ THỨ TỰ ASSERT (plan §5): ca điều phối chờ promise NGÃ NGŨ (`settled`), assert SPY trước (`fetch` /
 * confirm), assert LỖI sau — để mutant «đi tiếp sau lỗi» đỏ ở đúng spy, không ở dòng lỗi.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { z } from "zod";
import {
  FOUNDATION_FILE_ERROR_CODES,
  socialFileConfirmInputSchema,
  socialFileUploadUrlInputSchema,
} from "@mediaos/contracts";
import * as apiClient from "./api-client";
import { ApiError } from "./api-client";
import { socialFilesApi, uploadSocialAttachment } from "./social-files-api";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

const FILE_ID = "77777777-7777-4777-8777-777777777777";
const UPLOAD_URL = "https://storage.invalid/bucket/obj-1";

/** Hình dạng THẬT của `054` (FOUNDATION `RegisterFileResponse`). */
const REGISTERED = {
  fileId: FILE_ID,
  uploadStatus: "Pending",
  uploadUrl: UPLOAD_URL,
  expiresAt: "2026-10-02T10:00:00.000Z",
};
/** Hình dạng THẬT của `055` (FOUNDATION `ConfirmUploadResponse`). */
const CONFIRMED = { fileId: FILE_ID, uploadStatus: "Uploaded", sizeBytes: 3 };

type ApiCall = [string, z.ZodType<unknown>, RequestInit | undefined];

const register = vi.fn<(...a: ApiCall) => Promise<unknown>>();
const confirm = vi.fn<(...a: ApiCall) => Promise<unknown>>();

const pngFile = (): File => new File(["abc"], "a.png", { type: "image/png" });

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  register.mockReset().mockResolvedValue(REGISTERED);
  confirm.mockReset().mockResolvedValue(CONFIRMED);
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockImplementation(((...args: ApiCall) =>
    args[0].endsWith("/confirm") ? confirm(...args) : register(...args)) as never);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
});

afterEach(() => {
  fetchSpy.mockRestore();
});

const bodyOf = (call: ApiCall | undefined): unknown =>
  JSON.parse(String(call?.[2]?.body ?? "null"));

describe("W1 — ALLOW: 054 → PUT → 055, đúng thứ tự và đúng hợp đồng", () => {
  it("bài: body 054/055 qua schema `.strict()`; PUT Content-Type khớp MIME đã khai + credentials omit", async () => {
    const pending = uploadSocialAttachment(pngFile(), "post");
    await pending.catch(() => undefined);

    // SPY trước: thiếu pha confirm thì tệp nằm `Pending` và 002 sẽ 422 ATTACHMENT_INVALID về sau.
    expect(confirm).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual({
      fileId: FILE_ID,
      kind: "image",
      name: "a.png",
      sizeBytes: 3,
      mimeType: "image/png",
    });

    // 054 — path, method, body đúng hợp đồng; schema truyền vào nhận payload thật của BE.
    const reg = register.mock.calls[0];
    expect(reg?.[0]).toBe("/social/files/upload-url");
    expect(reg?.[2]?.method).toBe("POST");
    const regBody = bodyOf(reg);
    expect(regBody).toEqual({
      target: "post",
      originalName: "a.png",
      declaredMimeType: "image/png",
      sizeBytes: 3,
    });
    expect(socialFileUploadUrlInputSchema.safeParse(regBody).success).toBe(true);
    expect(reg?.[1].safeParse(REGISTERED).success).toBe(true);

    // PUT — CHÍNH URL presign, Content-Type = MIME đã khai (server ký kèm ContentType), không cookie.
    const [putUrl, putInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(putUrl).toBe(UPLOAD_URL);
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers).toEqual({ "Content-Type": "image/png" });
    expect(putInit.credentials).toBe("omit");

    // 055 — CÓ body `{target}` (KHÁC chat), schema nhận payload thật.
    const conf = confirm.mock.calls[0];
    expect(conf?.[0]).toBe(`/social/files/${FILE_ID}/confirm`);
    expect(conf?.[2]?.method).toBe("POST");
    expect(bodyOf(conf)).toEqual({ target: "post" });
    expect(socialFileConfirmInputSchema.safeParse(bodyOf(conf)).success).toBe(true);
    expect(conf?.[1].safeParse(CONFIRMED).success).toBe(true);
  });

  it("bình luận: target `comment` đi vào CẢ HAI pha (055 hỏi đúng cặp mà 054 đã hỏi)", async () => {
    await uploadSocialAttachment(pngFile(), "comment").catch(() => undefined);
    expect(bodyOf(register.mock.calls[0])).toMatchObject({ target: "comment" });
    expect(bodyOf(confirm.mock.calls[0])).toEqual({ target: "comment" });
  });
});

describe("W2–W5 — DENY: pha nào lỗi ⇒ DỪNG, ném NGUYÊN lỗi, không trả `fileId`", () => {
  it("W2 — 054 ném 415 MIME ⇒ PUT 0 lần, confirm 0 lần, lỗi ngã ngũ LÀ đúng `ApiError` đó", async () => {
    const err = new ApiError(415, FOUNDATION_FILE_ERROR_CODES.MIME, "MIME không được phép");
    register.mockRejectedValue(err);

    const settled = await uploadSocialAttachment(pngFile(), "post").then(
      () => "resolved",
      (e: unknown) => e,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    // `toBe`, không `toThrow(/…/)`: bọc lại lỗi là mất `ApiError.code` ⇒ khay không nói được lý do.
    expect(settled).toBe(err);
  });

  it("W3 — PUT trả 403 ⇒ confirm 0 lần; lỗi nói HTTP 403", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 403 }));

    const settled = await uploadSocialAttachment(pngFile(), "post").then(
      () => "resolved",
      (e: unknown) => e,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(() => {
      throw settled;
    }).toThrow(/HTTP 403/);
  });

  it("W4 — confirm ném ⇒ promise REJECT đúng lỗi đó (không trả `fileId` của tệp chưa xác nhận)", async () => {
    const confirmErr = new ApiError(
      422,
      FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
      "kích thước không khớp",
    );
    confirm.mockRejectedValue(confirmErr);

    await expect(uploadSocialAttachment(pngFile(), "post")).rejects.toBe(confirmErr);
  });

  it("W5 — huỷ GIỮA lượt PUT ⇒ reject, confirm 0 lần; `fetch` nhận ĐÚNG `signal`", async () => {
    const ctrl = new AbortController();
    fetchSpy.mockImplementation(() => {
      // Huỷ ngay khi bytes bắt đầu chảy — mô phỏng người dùng gỡ tệp giữa lượt tải.
      ctrl.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    const settled = await uploadSocialAttachment(pngFile(), "post", { signal: ctrl.signal }).then(
      () => "resolved",
      (e: unknown) => e,
    );

    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.signal).toBe(ctrl.signal);
    expect(confirm).not.toHaveBeenCalled();
    expect(() => {
      throw settled;
    }).toThrow(/huỷ/);
  });

  it("`signal` đi vào CẢ pha 054 và 055 (huỷ được cả khi đang chờ API, không chỉ lúc PUT)", async () => {
    const ctrl = new AbortController();
    await uploadSocialAttachment(pngFile(), "post", { signal: ctrl.signal }).catch(() => undefined);
    expect(register.mock.calls[0]?.[2]?.signal).toBe(ctrl.signal);
    expect(confirm.mock.calls[0]?.[2]?.signal).toBe(ctrl.signal);
  });
});

describe("W6 — trình duyệt không suy ra MIME", () => {
  it("`file.type === ''` ⇒ khai VÀ PUT `application/octet-stream` (hai bên phải khớp)", async () => {
    const blank = new File(["abc"], "ghi-chu", { type: "" });

    await expect(uploadSocialAttachment(blank, "post")).resolves.toMatchObject({
      mimeType: "application/octet-stream",
      kind: "file",
    });
    expect(bodyOf(register.mock.calls[0])).toMatchObject({
      declaredMimeType: "application/octet-stream",
    });
    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).headers).toEqual({
      "Content-Type": "application/octet-stream",
    });
  });
});

describe("socialFilesApi — hai route mỏng", () => {
  it("`requestUploadUrl` / `confirm` gọi đúng path + method", async () => {
    await socialFilesApi
      .requestUploadUrl({
        target: "post",
        originalName: "a.png",
        declaredMimeType: "image/png",
        sizeBytes: 3,
      })
      .catch(() => undefined);
    await socialFilesApi.confirm(FILE_ID, "comment").catch(() => undefined);

    expect(register.mock.calls[0]?.[0]).toBe("/social/files/upload-url");
    expect(confirm.mock.calls[0]?.[0]).toBe(`/social/files/${FILE_ID}/confirm`);
    expect(bodyOf(confirm.mock.calls[0])).toEqual({ target: "comment" });
  });
});
