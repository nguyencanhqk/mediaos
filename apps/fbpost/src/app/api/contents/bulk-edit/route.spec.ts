import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResponse } from "@/lib/types";
import type { BulkEditResult } from "@/lib/bulk-edit";

/**
 * Sua hang loat o RANH GIOI HTTP.
 *
 * Bai quan trong nhat o day: goi endpoint ma KHONG noi gi ve `dryRun` thi khong duoc ghi gi. Mot
 * endpoint "sua hang loat" mac dinh ghi la kieu API ma mot cu goi lo tay doi ca thu vien noi dung
 * — va khong co duong lui, vi khong co ban sao truoc khi sua.
 *
 * (Cong phien nam o `middleware.ts`, da co bai rieng — o day chi kiem tang handler.)
 */

let dataDir: string;

beforeEach(() => {
  dataDir = join(mkdtempSync(join(tmpdir(), "fbpost-bulk-route-")), "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "kek.bin"), randomBytes(32));
  process.env.SOCIAL_DATA_DIR = dataDir;
  process.env.SOCIAL_KEK_PATH = join(dataDir, "kek.bin");
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  vi.resetModules();
});

function req(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3500/api/contents/bulk-edit"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function call(body: unknown) {
  const { POST } = await import("./route");
  const response = await POST(req(body));
  return {
    status: response.status,
    body: (await response.json()) as ApiResponse<BulkEditResult>,
  };
}

async function seedContent(message: string) {
  const { createContent, getContent } = await import("@/lib/repo/content-repo");
  const content = createContent({ type: "text", message });
  return { id: content.id, read: () => getContent(content.id)?.message };
}

describe("POST /api/contents/bulk-edit", () => {
  it("KHONG khai dryRun = chi xem truoc, CSDL giu nguyen", async () => {
    const content = await seedContent("Hotline 0909");

    const { status, body } = await call({
      contentIds: [content.id],
      rules: [{ find: "0909", replace: "0388" }],
      fields: ["message"],
    });

    expect(status).toBe(200);
    expect(body.data?.applied).toBe(false);
    expect(body.data?.totalHits).toBe(1);
    expect(content.read()).toBe("Hotline 0909");
  });

  it("dryRun: false moi ghi that", async () => {
    const content = await seedContent("Hotline 0909");

    const { body } = await call({
      contentIds: [content.id],
      rules: [{ find: "0909", replace: "0388" }],
      fields: ["message"],
      dryRun: false,
    });

    expect(body.data?.applied).toBe(true);
    expect(content.read()).toBe("Hotline 0388");
  });

  it("o van ban khai trung khong lam so cho bi dem hai lan", async () => {
    const content = await seedContent("Hotline 0909");

    const { body } = await call({
      contentIds: [content.id],
      rules: [{ find: "0909", replace: "0388" }],
      fields: ["message", "message"],
    });

    expect(body.data?.totalHits).toBe(1);
    expect(body.data?.changedContents[0].changes).toHaveLength(1);
  });

  it("tu choi yeu cau thieu du kien va KHONG ghi gi", async () => {
    const content = await seedContent("Hotline 0909");
    const base = {
      contentIds: [content.id],
      rules: [{ find: "0909", replace: "0388" }],
      fields: ["message"],
      dryRun: false,
    };

    for (const bad of [
      { ...base, contentIds: [] },
      { ...base, rules: [] },
      { ...base, rules: [{ find: "", replace: "x" }] },
      { ...base, fields: [] },
      { ...base, fields: ["khong-co-o-nay"] },
      { ...base, contentIds: Array.from({ length: 501 }, (_, i) => i + 1) },
    ]) {
      const { status, body } = await call(bad);
      expect(status).toBe(400);
      expect(body.success).toBe(false);
    }

    expect(content.read()).toBe("Hotline 0909");
  });
});
