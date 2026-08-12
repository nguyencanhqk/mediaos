import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { config, middleware } from "./middleware";

const SECRET = "example-session-secret-".padEnd(40, "x");
const USER = { sub: "user-1", email: "a@example.com", name: "Nguoi Dung" };

function request(path: string, cookie?: string): NextRequest {
  const req = new NextRequest(new URL(`http://localhost:3500${path}`));
  if (cookie) req.cookies.set(SESSION_COOKIE, cookie);
  return req;
}

/** Liet ke moi route handler that su ton tai — khong go tay danh sach roi tu tin la du. */
function listApiRoutes(dir: string, prefix = "/api"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listApiRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "route.ts") {
      // Doan `[id]` thay bang mot gia tri that de duong dan hop le khi goi thu.
      out.push(prefix.replace(/\[\w+\]/g, "1"));
    }
  }
  return out;
}

beforeEach(() => {
  process.env.SOCIAL_SESSION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SOCIAL_SESSION_SECRET;
});

describe("cong phien", () => {
  it("MOI route API KHONG thuoc allowlist deu bi chan khi khong co phien", async () => {
    const routes = listApiRoutes(join(process.cwd(), "src/app/api")).filter(
      (r) => r !== "/api/auth/sso",
    );
    // Neu con so nay tut xuong bat ngo thi bai test dang quet nham cho — bao dong som.
    // Nang 20 → 24 khi them /api/library, /api/library/import, /api/library/roots
    // (S10-SOCIAL-LIB-1/2): nguong phai di theo so route THAT, khong thi mot ngay nao do nua so
    // route bien mat ma bai van xanh. Hien co 25 route, tru /api/auth/sso da loc ra = 24.
    expect(routes.length).toBeGreaterThanOrEqual(24);

    const lotQua: string[] = [];
    for (const route of routes) {
      const res = await middleware(request(route));
      if (res.status !== 401) lotQua.push(`${route} → ${res.status}`);
    }
    expect(lotQua).toEqual([]);
  });

  it("cau SSO la duong DUY NHAT di qua duoc — kiem theo DUONG DAN, khong theo file", async () => {
    // Kiem `/api/auth/sso` nhu mot duong dan chu khong quet thu muc: cong phien phai mo dung
    // duong nay ke ca truoc khi route handler duoc viet (BE-1), va bai test nay chinh la thu
    // giu cho allowlist khong am tham phinh them mot muc thu hai.
    const res = await middleware(request("/api/auth/sso"));
    expect(res.status).toBe(200);
  });

  it("route API co phien hop le thi di qua", async () => {
    const token = await signSession(USER);
    const res = await middleware(request("/api/pages", token));
    expect(res.status).toBe(200);
  });

  it("phien HET HAN bi chan y nhu khong co phien", async () => {
    const expired = await signSession(USER, Math.floor(Date.now() / 1000) - 9 * 60 * 60);
    const res = await middleware(request("/api/pages", expired));
    expect(res.status).toBe(401);
  });

  it("route API tra ve 401 JSON, khong phai HTML dieu huong", async () => {
    const res = await middleware(request("/api/accounts"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("trang (khong phai API) thi dieu huong ve /login", async () => {
    const res = await middleware(request("/compose"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("chinh trang /login thi khong bi dieu huong (khong lap vo tan)", async () => {
    const res = await middleware(request("/login"));
    expect(res.status).toBe(200);
  });

  it("duong dan la KHONG co trong allowlist deu bi chan", async () => {
    for (const path of ["/", "/settings", "/api/khong-ton-tai", "/api/auth/sso-gia"]) {
      const res = await middleware(request(path));
      expect(res.status, `${path} phai bi chan`).not.toBe(200);
    }
  });

  it("callback OAuth Facebook KHONG duoc mo — no dua vao cookie phien san co", async () => {
    const res = await middleware(request("/api/auth/facebook/callback?code=x&state=y"));
    expect(res.status).toBe(401);
  });
});

/**
 * Hai trang Facebook BAT BUOC doc duoc khi CHUA dang nhap.
 *
 * Day khong phai tien nghi: App Dashboard cua Meta bat co "URL chinh sach quyen rieng tu" va
 * "Xoa du lieu nguoi dung" truoc khi cho app sang che do Live, va nguoi kiem duyet mo chung
 * bang trinh duyet KHONG co phien. Truoc ban va nay ca hai tra 307 → /login, tuc dung thu
 * chung sinh ra de phuc vu thi lai khong phuc vu duoc (do that tren PROD 12/08).
 */
describe("hai trang cong khai cho Facebook", () => {
  const PUBLIC_PAGES = ["/chinh-sach-quyen-rieng-tu", "/xoa-du-lieu"];

  it("doc duoc khi KHONG co phien", async () => {
    for (const path of PUBLIC_PAGES) {
      const res = await middleware(request(path));
      expect(res.status, `${path} phai mo cho nguoi CHUA dang nhap`).toBe(200);
    }
  });

  it("van mo khi CO phien — mo them duong khong duoc lam hong duong cu", async () => {
    // Ca ALLOW doi chung: thieu no thi mot ban "vá" chan sach ca hai chieu van xanh.
    const token = await signSession(USER);
    for (const path of PUBLIC_PAGES) {
      const res = await middleware(request(path, token));
      expect(res.status, `${path} phai mo ca khi da dang nhap`).toBe(200);
    }
  });

  it("duong dan GAN GIONG khong an theo — allowlist khong ro sang ben canh", async () => {
    for (const path of [
      "/chinh-sach-quyen-rieng-tu-gia",
      "/xoa-du-lieu-gia",
      "/xoa-du-lieuX",
      "/api/xoa-du-lieu",
    ]) {
      const res = await middleware(request(path));
      expect(res.status, `${path} phai bi chan`).not.toBe(200);
    }
  });

  it("hai trang nay KHONG duoc de con — `isPublic` mo ca cay con theo tien to", () => {
    // `isPublic` khop `pathname.startsWith(`${p}/`)`, nen bat ky route nao them vao ben duoi hai
    // thu muc nay se AM THAM thanh cong khai. Khong viet thanh loi binh (khong ai doc) ma thanh
    // mot cong: ngay ai do them `[id]/page.tsx` o day, bai nay DO va buoc ho quyet dinh co y.
    for (const page of PUBLIC_PAGES) {
      const dir = join(process.cwd(), "src/app", page);
      expect(readdirSync(dir), `${page} co them route con — xem lai pham vi cong khai`).toEqual([
        "page.tsx",
      ]);
    }
  });
});

describe("pham vi matcher", () => {
  it("matcher KHONG loai tru /api — cho can gac nhat phai nam trong tam phu", () => {
    const pattern = new RegExp(config.matcher[0].replace(/^\//, "^/"));
    expect(pattern.test("/api/pages")).toBe(true);
    expect(pattern.test("/compose")).toBe(true);
  });
});
