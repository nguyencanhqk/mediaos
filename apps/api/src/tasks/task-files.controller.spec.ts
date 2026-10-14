/**
 * S19-OPS-TASKFILEURL-1 — U-1: route JSON `downloadUrl` và route 302 `download` là HAI cửa của MỘT hàm kiểm
 * (`TaskFileService.getDownloadUrl`, bất biến B1) dưới CÙNG cổng quyền (B2). Plan §6 U-1 (a)–(d).
 *
 * Tra handler qua chỉ mục (không gọi thẳng `prototype.downloadUrl`): khi handler chưa tồn tại, ca phải ĐỎ vì
 * assert («expected undefined …»), không phải vì TypeError của `Reflect.getMetadata(…, undefined)`.
 */

import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { IDEMPOTENT } from "../common/idempotency/idempotency.decorator";
import { REQUIRE_PERMISSION } from "../permission/require-permission.decorator";
import type { TaskFileService } from "./task-file.service";
import { TaskFilesController } from "./task-files.controller";

type Handler = (...args: unknown[]) => Promise<unknown>;

function handler(name: string): Handler | undefined {
  const h = (TaskFilesController.prototype as unknown as Record<string, unknown>)[name];
  return typeof h === "function" ? (h as Handler) : undefined;
}

function meta(key: string, name: string): unknown {
  const h = handler(name);
  return h ? Reflect.getMetadata(key, h) : undefined;
}

const USER = { id: "user-1", companyId: "co-1" };
const TASK_ID = "task-1";
const FILE_ID = "file-1";
const DTO = { url: "https://storage.example.test/obj", expiresAt: "2026-10-14T00:05:00.000Z" };

function controllerWithMock() {
  const getDownloadUrl = vi.fn().mockResolvedValue(DTO);
  const ctrl = new TaskFilesController({ getDownloadUrl } as unknown as TaskFileService);
  return { ctrl, getDownloadUrl };
}

describe("TaskFilesController — downloadUrl (JSON) ⇄ download (302)", () => {
  it("(a) metadata REQUIRE_PERMISSION của downloadUrl DEEP-EQUAL của download", () => {
    expect(meta(REQUIRE_PERMISSION, "download")).toEqual({ action: "read", resourceType: "task" });
    expect(meta(REQUIRE_PERMISSION, "downloadUrl")).toEqual(meta(REQUIRE_PERMISSION, "download"));
  });

  it("(b) downloadUrl gọi svc.getDownloadUrl(user, taskId, fileId) đúng 1 lần, trả NGUYÊN giá trị", async () => {
    const { ctrl, getDownloadUrl } = controllerWithMock();
    const h = handler("downloadUrl");
    expect(typeof h).toBe("function");
    const out = await h!.call(ctrl, { user: USER }, TASK_ID, FILE_ID);
    expect(getDownloadUrl).toHaveBeenCalledTimes(1);
    expect(getDownloadUrl).toHaveBeenCalledWith(USER, TASK_ID, FILE_ID);
    expect(out).toBe(DTO);
  });

  it("(c) download redirect 302 tới ĐÚNG url của cùng hàm kiểm", async () => {
    const { ctrl, getDownloadUrl } = controllerWithMock();
    const redirect = vi.fn();
    await ctrl.download({ user: USER } as never, TASK_ID, FILE_ID, {
      redirect,
    } as unknown as Response);
    expect(getDownloadUrl).toHaveBeenCalledWith(USER, TASK_ID, FILE_ID);
    expect(redirect).toHaveBeenCalledWith(302, DTO.url);
  });

  it("(d) downloadUrl KHÔNG @Idempotent — interceptor idempotency sẽ LƯU body mang URL ký (B7)", () => {
    expect(typeof handler("downloadUrl")).toBe("function");
    expect(meta(IDEMPOTENT, "downloadUrl")).toBeUndefined();
  });
});
