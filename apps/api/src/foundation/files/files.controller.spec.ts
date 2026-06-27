/**
 * S1-FND-FILE-1 — FilesController thin-delegation unit spec (no HTTP server).
 *
 * The controller is a thin layer over FileService (FilePolicy is the real decision point, asserted in
 * files.service.spec.ts). Here we assert: each route delegates to the right service method with the
 * authenticated user, parses the body via the contract schema, forces fileId from the route on link.
 * S1-FND-WIRE-DRIFT-1: controller returns RAW data (envelope do interceptor toàn cục dựng — KHÔNG tự bọc);
 * list trả `paginated(data, pagination)` (pagination block đỉnh); /download redirect 302. PermissionGuard
 * gating is integration/e2e territory (class-level @UseGuards + @RequirePermission per route).
 */

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilesController } from "./files.controller";

const USER = { id: randomUUID(), companyId: randomUUID() };
const req = { user: USER } as never;

function makeController() {
  const service = {
    upload: vi.fn(async () => ({ id: "f1" })),
    list: vi.fn(async () => ({ data: [{ id: "f1" }], meta: { total: 1, page: 1, limit: 20 } })),
    getMetadata: vi.fn(async () => ({ id: "f1" })),
    getDownloadUrl: vi.fn(async () => ({
      url: "https://x/y",
      expiresAt: "2026-06-24T00:05:00.000Z",
    })),
    link: vi.fn(async () => ({ id: "l1" })),
    unlink: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
  };
  const controller = new FilesController(service as never);
  return { controller, service };
}

describe("FilesController", () => {
  let h: ReturnType<typeof makeController>;
  beforeEach(() => {
    h = makeController();
  });

  it("POST /foundation/files/upload → upload(user, parsed input), RAW data (no manual envelope)", async () => {
    const res = await h.controller.upload(req, {
      originalName: "a.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: 10,
      visibility: "Private",
    } as never);
    expect(h.service.upload).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ originalName: "a.pdf" }),
    );
    expect(res).toMatchObject({ id: "f1" });
  });

  it("GET /foundation/files → paginated(data, pagination block top-level)", async () => {
    const res = await h.controller.list(req, { page: 1, limit: 20 } as never);
    expect(h.service.list).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(res.data).toEqual([{ id: "f1" }]);
    // pagination = block đỉnh (API-01 §16.1), KHÔNG nằm trong meta.
    expect(res.pagination).toMatchObject({ total: 1, page: 1, per_page: 20, total_pages: 1 });
  });

  it("GET /foundation/files/:id → getMetadata(user, id), RAW data", async () => {
    const res = await h.controller.getOne(req, "f1");
    expect(h.service.getMetadata).toHaveBeenCalledWith(USER, "f1");
    expect(res).toMatchObject({ id: "f1" });
  });

  it("GET /foundation/files/:id/download-url → getDownloadUrl(user, id), RAW {url}", async () => {
    const res = await h.controller.downloadUrl(req, "f1");
    expect(h.service.getDownloadUrl).toHaveBeenCalledWith(USER, "f1");
    expect(res).toMatchObject({ url: "https://x/y" });
  });

  it("GET /foundation/files/:id/download → 302 redirect tới signed URL", async () => {
    const res = { redirect: vi.fn() };
    await h.controller.download(req, "f1", res as never);
    expect(h.service.getDownloadUrl).toHaveBeenCalledWith(USER, "f1");
    expect(res.redirect).toHaveBeenCalledWith(302, "https://x/y");
  });

  it("POST /files/:id/link → forces fileId from route into parsed input (anti-spoof)", async () => {
    const routeFileId = randomUUID();
    const bodyFileId = randomUUID(); // a different file the client tries to smuggle via body
    const entityId = randomUUID();
    await h.controller.link(req, routeFileId, {
      fileId: bodyFileId,
      moduleCode: "HR",
      entityType: "EmployeeContract",
      entityId,
      linkType: "Contract",
      accessScope: "Company",
      isPrimary: false,
    } as never);
    // fileId from the :id route wins over the body value (anti-spoof).
    expect(h.service.link).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ fileId: routeFileId }),
    );
  });

  it("DELETE /files/links/:linkId → unlink(user, linkId)", async () => {
    await h.controller.unlink(req, "l1");
    expect(h.service.unlink).toHaveBeenCalledWith(USER, "l1");
  });

  it("DELETE /files/:id → deleteFile(user, id)", async () => {
    await h.controller.remove(req, "f1");
    expect(h.service.deleteFile).toHaveBeenCalledWith(USER, "f1");
  });
});
