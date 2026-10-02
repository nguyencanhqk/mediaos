/**
 * S19-SEC-MAILCREDEXFIL-1 — mật khẩu SMTP ĐÃ LƯU (write-only) KHÔNG được tới đích do client chọn.
 *
 * Hai đường rò trước WO (người giữ `configure-mail` đọc gián tiếp được secret mà DTO không bao giờ trả):
 *   (A) `POST /settings/mail-config/test` vắng password ⇒ server giải mã mật khẩu đã lưu rồi AUTH tới
 *       host/port/username/secure lấy từ BODY;
 *   (B) `PUT /settings/mail-config` đổi đích mà vắng password ⇒ repo UPDATE cột đích, GIỮ envelope cũ ⇒
 *       lời mời kế tiếp (`InviteMailService`) AUTH mật khẩu cũ tới đích mới.
 * Cộng oracle (C): `errorMessage` của route test từng trả nguyên dòng banner của bất kỳ cổng TCP nào.
 *
 * Đo qua DÂY, không qua mock: HTTP thật (guard/DTO/filter) + DB lane + nodemailer THẬT + hai server SMTP
 * giả trên 127.0.0.1 — L («legit», đích đã lưu) và E («evil», đích kẻ tấn công chọn). Server giả mặc định
 * quảng bá AUTH (không thì nodemailer bỏ đăng nhập mà vẫn "thành công" — xem fake-smtp-server.ts), và mỗi
 * server có một ca DƯƠNG chứng minh nó ghi nhận được AUTH (P1 cho L, P3 cho E) ⇒ assert «rỗng» không
 * xanh-rỗng. "Không một kết nối" đo bằng `connections` (đếm TCP accept), không suy từ `commands` rỗng.
 *
 * Lớp DB (owner D5, mig 0591): `mediaos_app` không còn quyền UPDATE cột đích — đo ở describe cuối.
 *
 * GATE CỨNG `hasDb && LANE_DB` — cần Postgres thật cho withTenant/RLS + envelope + grant.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createServer, type AddressInfo, type Server } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { MailConfigRepository } from "../../src/settings/mail-config.repository";
import { InviteMailService } from "../../src/user-invites/invite-mail.service";
import { startFakeSmtpServer, type FakeSmtpServer } from "../helpers/fake-smtp-server";
import { loginPasswordFixture, smtpPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

/** Hợp đồng dây mà FE bắt theo — ghim LITERAL (không import hằng: hằng mất thì ca phải đỏ, không `undefined === undefined`). */
const MAIL_PASSWORD_REQUIRED = "FOUNDATION-ERR-MAIL-PASSWORD-REQUIRED";

// Fixture giống-secret GHÉP CHUỖI (CLAUDE.md §5). Hai tag KHÔNG lồng nhau: assert dùng so khớp chuỗi con.
const LOGIN_PW = loginPasswordFixture("mcx");
const SMTP_PW_STORED = smtpPasswordFixture("mcx-stored");
const SMTP_PW_ROTATED = smtpPasswordFixture("mcx-rotated");
const INVITE_TOKEN = ["fixture", "invite", "token", "mcx"].join("_");

const LOCALHOST = "127.0.0.1";
const LEGIT_USER = "mailer@legit.example.test";
const EVIL_USER = "attacker@evil.example.test";
const FROM_EMAIL = "noreply@legit.example.test";
const INTERNAL_HOST = "internal-db-01.corp.local";

/** drizzle bọc lỗi pg — mã SQLSTATE có thể nằm ở `cause` (memory drizzle-hides-pg-code-in-cause). */
function pgCodeOf(err: unknown): unknown {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code ?? e?.cause?.code;
}

describe.skipIf(!hasLaneDb)(
  "S19-SEC-MAILCREDEXFIL-1 — mật khẩu SMTP đã lưu chỉ tới đích của CHÍNH hàng chứa nó",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let tAdmin = "";
    let adminUserId = "";
    let L: FakeSmtpServer;
    let E: FakeSmtpServer;

    const authPut = (u: string) =>
      request(app.getHttpServer()).put(u).set("Authorization", `Bearer ${tAdmin}`);
    const authPost = (u: string) =>
      request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${tAdmin}`);

    /** Đích đã lưu: L, tài khoản legit, KHÔNG TLS (server giả không có cert). */
    const legitDest = () => ({
      host: LOCALHOST,
      port: L.port,
      username: LEGIT_USER,
      secure: false,
    });

    const putStored = (over: Record<string, unknown> = {}) =>
      authPut("/settings/mail-config").send({
        ...legitDest(),
        fromName: "Phòng Nhân sự",
        fromEmail: FROM_EMAIL,
        password: SMTP_PW_STORED,
        ...over,
      });

    const storedRow = async () => {
      const res = await direct.query(
        `SELECT id, host, port, username, secure, from_name, secret_ciphertext, encrypted_dek
           FROM company_mail_configs WHERE company_id = $1 AND scope = 'default'`,
        [A.companyId],
      );
      expect(res.rows, "phải có đúng 1 hàng config default").toHaveLength(1);
      return res.rows[0] as {
        id: string;
        host: string;
        port: number;
        username: string;
        secure: boolean;
        from_name: string | null;
        secret_ciphertext: Buffer;
        encrypted_dek: Buffer;
      };
    };

    const mailAuditCount = async (): Promise<number> => {
      const res = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND object_type = 'mail_config'`,
        [A.companyId],
      );
      return res.rows[0].n as number;
    };

    /** Số kết nối TCP mỗi server nhận được TRONG phần "act" của một ca. */
    const connectionsDuring = async <T,>(act: () => PromiseLike<T>) => {
      const before = { L: L.connections, E: E.connections };
      const result = await act();
      return { result, L: L.connections - before.L, E: E.connections - before.E };
    };

    const clearSinks = () => {
      for (const s of [L, E]) {
        s.commands.splice(0);
        s.auths.splice(0);
        s.messages.splice(0);
      }
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      L = await startFakeSmtpServer();
      E = await startFakeSmtpServer();

      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "mcx");
      const email = `admin-${randomUUID().slice(0, 8)}@mcx.local`;
      adminUserId = await seedUser(direct, A.companyId, email, hash);
      const role = await seedRole(direct, A.companyId, `mcx-admin-${adminUserId.slice(0, 8)}`);
      const permId = await seedPermissionCatalog(direct, "configure-mail", "company", true);
      await seedRolePermission(direct, role, permId, "ALLOW", "Company");
      await seedUserRole(direct, adminUserId, role, A.companyId);

      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      tAdmin = login.body.data.accessToken as string;
    });

    afterAll(async () => {
      if (A) await cleanupTenants(direct, [A.companyId]);
      await direct?.end();
      await L?.close();
      await E?.close();
      await app?.close();
    });

    beforeEach(async () => {
      // Mỗi ca bắt đầu từ cùng một cấu hình đã lưu: đích L + STORED (PUT có password ⇒ envelope mới).
      const res = await putStored();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      clearSinks();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // ── (A) POST /test vắng password ─────────────────────────────────────────────────────────────

    it("R1: test vắng password trỏ sang server KHÁC ⇒ 400 mã MAIL-PASSWORD-REQUIRED, không một kết nối tới E lẫn L", async () => {
      const {
        result: res,
        L: toL,
        E: toE,
      } = await connectionsDuring(() =>
        authPost("/settings/mail-config/test").send({ ...legitDest(), port: E.port }),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe(MAIL_PASSWORD_REQUIRED);
      expect(toE).toBe(0);
      expect(toL).toBe(0);
      expect(E.auths).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(SMTP_PW_STORED);
    });

    it("R2a: test vắng password, username KHÁC trên cùng server ⇒ 400, L không nhận kết nối", async () => {
      // Trước WO: L nhận AUTH (EVIL_USER, STORED) — dò mật khẩu công ty trên tài khoản khác cùng nhà cung cấp.
      const { result: res, L: toL } = await connectionsDuring(() =>
        authPost("/settings/mail-config/test").send({ ...legitDest(), username: EVIL_USER }),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe(MAIL_PASSWORD_REQUIRED);
      expect(toL).toBe(0);
      expect(L.auths).toEqual([]);
    });

    it("R2b: hàng lưu secure=true, test vắng password HẠ xuống secure=false ⇒ 400, mật khẩu không đi chữ rõ", async () => {
      // Trước WO: L nhận AUTH PLAIN mật khẩu đã lưu trên kết nối KHÔNG mã hoá (hạ cấp có chủ ý).
      const put = await putStored({ secure: true });
      expect(put.status, JSON.stringify(put.body)).toBe(200);

      const { result: res, L: toL } = await connectionsDuring(() =>
        authPost("/settings/mail-config/test").send({ ...legitDest(), secure: false }),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe(MAIL_PASSWORD_REQUIRED);
      expect(toL).toBe(0);
      expect(L.auths).toEqual([]);
    });

    it("R2c: hàng lưu secure=false, body VẮNG secure (⇒ true) ⇒ 400 (chỉ status/mã có nghĩa: TLS tới L hỏng trước AUTH)", async () => {
      const { secure: _omitted, ...withoutSecure } = legitDest();

      const res = await authPost("/settings/mail-config/test").send(withoutSecure);

      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe(MAIL_PASSWORD_REQUIRED);
    });

    it("P1: test vắng password, đích KHỚP nguyên hàng ⇒ ok, L nhận AUTH bằng ĐÚNG mật khẩu đã lưu", async () => {
      const res = await authPost("/settings/mail-config/test").send(legitDest());

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toEqual({ ok: true });
      expect(L.auths).toEqual([
        expect.objectContaining({ username: LEGIT_USER, password: SMTP_PW_STORED }),
      ]);
      expect(E.connections).toBe(0);
    });

    // ── (B) PUT đổi đích vắng password ───────────────────────────────────────────────────────────

    it("R3: PUT đổi port sang E vắng password ⇒ 400; hàng y nguyên; lời mời kế tiếp vẫn đi L, E không kết nối", async () => {
      const before = await storedRow();

      const res = await authPut("/settings/mail-config").send({
        ...legitDest(),
        port: E.port,
        fromName: "Phòng Nhân sự",
        fromEmail: FROM_EMAIL,
      });

      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe(MAIL_PASSWORD_REQUIRED);
      const after = await storedRow();
      expect(after.id).toBe(before.id);
      expect(after.port).toBe(L.port);
      expect(after.secret_ciphertext.equals(before.secret_ciphertext)).toBe(true);

      vi.stubEnv("INVITE_ACTIVATION_URL", "https://app.example.test/activate");
      const { result: sent, E: toE } = await connectionsDuring(() =>
        app.get(InviteMailService).sendActivationEmail({
          companyId: A.companyId,
          companySlug: A.slug,
          companyName: "MCX",
          email: "nhanvien.moi@legit.example.test",
          fullName: "Nguyễn Văn A",
          token: INVITE_TOKEN,
        }),
      );
      expect(sent).toEqual({ sent: true });
      expect(L.auths).toEqual([
        expect.objectContaining({ username: LEGIT_USER, password: SMTP_PW_STORED }),
      ]);
      expect(toE).toBe(0);
    });

    it("P2: PUT CHỈ đổi fromName/fromEmail vắng password ⇒ 200, GIỮ envelope + id", async () => {
      const before = await storedRow();

      const res = await authPut("/settings/mail-config").send({
        ...legitDest(),
        fromName: "Ban Giám đốc",
        fromEmail: "bgd@legit.example.test",
      });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await storedRow();
      expect(after.id).toBe(before.id);
      expect(after.from_name).toBe("Ban Giám đốc");
      expect(after.secret_ciphertext.equals(before.secret_ciphertext)).toBe(true);
      expect(after.encrypted_dek.equals(before.encrypted_dek)).toBe(true);
    });

    it("P3: đổi đích CÓ mật khẩu mới ⇒ 200; test vắng password tới đích mới dùng mật khẩu MỚI, không bao giờ STORED", async () => {
      const put = await authPut("/settings/mail-config").send({
        host: LOCALHOST,
        port: E.port,
        username: EVIL_USER,
        secure: false,
        fromEmail: FROM_EMAIL,
        password: SMTP_PW_ROTATED,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);

      const res = await authPost("/settings/mail-config/test").send({
        host: LOCALHOST,
        port: E.port,
        username: EVIL_USER,
        secure: false,
      });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toEqual({ ok: true });
      expect(E.auths).toEqual([
        expect.objectContaining({ username: EVIL_USER, password: SMTP_PW_ROTATED }),
      ]);
      expect(JSON.stringify(E.auths)).not.toContain(SMTP_PW_STORED);
    });

    // ── Lớp repo đo RIÊNG (I2): vị từ đích trong câu UPDATE + nhánh 0 hàng, bỏ qua service ──────────

    it("R4: repo.upsert(envelope=null) với đích lệch ⇒ ném MailPasswordRequiredError, hàng y nguyên, KHÔNG audit", async () => {
      const before = await storedRow();
      const auditBefore = await mailAuditCount();

      const attempt = app.get(MailConfigRepository).upsert(
        A.companyId,
        randomUUID(),
        {
          scope: "default",
          host: LOCALHOST,
          port: E.port,
          username: LEGIT_USER,
          secure: false,
          fromName: null,
          fromEmail: FROM_EMAIL,
        },
        null,
        { audit: app.get(AuditService), actorUserId: adminUserId },
      );

      await expect(attempt).rejects.toMatchObject({ name: "MailPasswordRequiredError" });
      const after = await storedRow();
      expect(after.id).toBe(before.id);
      expect(after.port).toBe(L.port);
      expect(after.secret_ciphertext.equals(before.secret_ciphertext)).toBe(true);
      expect(await mailAuditCount()).toBe(auditBefore);
    });

    // ── (C) oracle errorMessage qua HTTP ─────────────────────────────────────────────────────────

    it("R5: test CÓ password tới một cổng không phải SMTP ⇒ câu cố định, KHÔNG dòng banner nào tới client", async () => {
      const banner: Server = await new Promise((resolve) => {
        const server = createServer((socket) => {
          socket.on("error", () => undefined);
          socket.write(`SSH-2.0-OpenSSH_9.6p1 ${INTERNAL_HOST}\r\n`);
        });
        server.listen(0, LOCALHOST, () => resolve(server));
      });
      try {
        const res = await authPost("/settings/mail-config/test").send({
          host: LOCALHOST,
          port: (banner.address() as AddressInfo).port,
          username: EVIL_USER,
          secure: false,
          password: SMTP_PW_ROTATED,
        });

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.ok).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain(INTERNAL_HOST);
        expect(JSON.stringify(res.body)).not.toContain("OpenSSH");
        expect(res.body.data.errorMessage).toBe(
          "Máy chủ không trả lời theo giao thức SMTP — kiểm tra cổng.",
        );
      } finally {
        await new Promise((done) => banner.close(done));
      }
    });

    // ── Lớp DB (owner D5, mig 0591): mediaos_app KHÔNG còn quyền UPDATE cột đích ───────────────────

    it("D5a: catalog — mediaos_app không UPDATE được host/port/username/secure, vẫn UPDATE được from_*/updated_at", async () => {
      const res = await direct.query(
        `SELECT c AS col, has_column_privilege('mediaos_app', 'company_mail_configs', c, 'UPDATE') AS can
           FROM unnest(ARRAY['host','port','username','secure','from_name','from_email','updated_at']) AS c`,
      );
      const can = Object.fromEntries(res.rows.map((r) => [r.col as string, r.can as boolean]));
      expect(can).toEqual({
        host: false,
        port: false,
        username: false,
        secure: false,
        from_name: true,
        from_email: true,
        updated_at: true,
      });
    });

    it("D5b: UPDATE cột đích THẬT bằng role app (withTenant) ⇒ 42501, hàng y nguyên", async () => {
      const before = await storedRow();

      const attempt = app
        .get(DatabaseService)
        .withTenant(A.companyId, (tx) =>
          tx.execute(
            sql`UPDATE company_mail_configs SET port = ${E.port} WHERE company_id = ${A.companyId} AND scope = 'default'`,
          ),
        );

      const err = await attempt.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, "UPDATE cột đích phải bị DB từ chối").not.toBeNull();
      expect(pgCodeOf(err)).toBe("42501");
      const after = await storedRow();
      expect(after.port).toBe(before.port);
    });
  },
);
