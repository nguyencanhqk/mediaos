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
 * Lớp MẬT MÃ (E) — S19-SEC-MAILAADBIND-1: id + đích là NGỮ CẢNH MÃ HOÁ của envelope ⇒ kẻ ghi «ngoài app»
 * (superuser/DBA, hoặc một đường DELETE+INSERT của role app — 0591 không chặn INSERT/DELETE) đổi đích mà không
 * mã hoá lại thì giải mã HỎNG: route test trả câu «nhập lại mật khẩu», lời mời `decrypt_failed`, 0 kết nối SMTP.
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
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { MailConfigRepository } from "../../src/settings/mail-config.repository";
import { InviteMailService } from "../../src/user-invites/invite-mail.service";
import { applyMainPipeline } from "../helpers/bootstrap-app";
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
    const connectionsDuring = async <T>(act: () => PromiseLike<T>) => {
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
      // Pipeline y hệt main.ts (lưới S16-TEST-PIPELINE-PARITY-1) + listen(0) (census S18-QA-SUPERTESTLISTEN-1).
      app = applyMainPipeline(moduleRef.createNestApplication());
      await app.init();
      await app.listen(0);

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
      // Đối chứng dương: beforeEach vừa PUT (có audit) — 0 ở đây = bộ đếm mù (vd RLS che) ⇒ "0 == 0" xanh-rỗng.
      expect(auditBefore, "bộ đếm audit phải thấy các lần PUT trước").toBeGreaterThan(0);

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

    it("D5a: catalog — tập cột mediaos_app UPDATE được ĐÚNG BẰNG {from_email, from_name, updated_at}; không UPDATE cấp bảng", async () => {
      // Duyệt MỌI cột (không chỉ 7 cột đã biết): một grant cột mới về sau (id, scope, company_id, envelope…) cũng đỏ.
      const cols = await direct.query(
        `SELECT a.attname::text AS col
           FROM pg_attribute a
          WHERE a.attrelid = 'public.company_mail_configs'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('mediaos_app', a.attrelid, a.attnum, 'UPDATE')
          ORDER BY 1`,
      );
      expect(cols.rows.map((r) => r.col as string)).toEqual([
        "from_email",
        "from_name",
        "updated_at",
      ]);
      const table = await direct.query(
        `SELECT has_table_privilege('mediaos_app', 'public.company_mail_configs', 'UPDATE') AS can`,
      );
      expect(table.rows[0].can).toBe(false);
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

    // ── (E) Lớp MẬT MÃ — S19-SEC-MAILAADBIND-1: id + đích là ngữ cảnh mã hoá của envelope ────────────

    /** Câu route test khi mật khẩu đã lưu không mở được (owner D2, KÝ LẠI 02/10: kiểm tra đích TRƯỚC) — LITERAL. */
    const DECRYPT_MSG =
      "Không dùng được mật khẩu đã lưu. Kiểm tra lại máy chủ, cổng, tên đăng nhập và TLS (có thể đã bị thay đổi ngoài ứng dụng) trước khi nhập lại mật khẩu SMTP rồi bấm Lưu.";
    /** Hợp đồng dây của 400 không mã module (filter `httpStatusToCode(400)`) + câu của B4 — ghim LITERAL. */
    const VALIDATION_ERROR = "VALIDATION-ERR-001";
    const NOT_PERSISTED_MSG = "Máy chủ hoặc tên đăng nhập SMTP chứa ký tự không hợp lệ.";
    /** Surrogate lẻ: đi được qua JSON/Zod nhưng PG lưu thành U+FFFD ⇒ giá trị lưu ≠ giá trị đã gắn (M11). */
    const LONE_SURROGATE = String.fromCharCode(0xd800);

    type Destination = ReturnType<typeof legitDest>;
    type StoredRow = Awaited<ReturnType<typeof storedRow>>;

    const destOfRow = (r: StoredRow): Destination => ({
      host: r.host,
      port: r.port,
      username: r.username,
      secure: r.secure,
    });

    /** Số hàng cấu hình (mọi scope) của công ty A — đọc bằng superuser, không qua RLS. */
    const configCount = async (): Promise<number> => {
      const res = await direct.query(
        `SELECT count(*)::int AS n FROM company_mail_configs WHERE company_id = $1`,
        [A.companyId],
      );
      return res.rows[0].n as number;
    };

    const sendInvite = () => {
      vi.stubEnv("INVITE_ACTIVATION_URL", "https://app.example.test/activate");
      return app.get(InviteMailService).sendActivationEmail({
        companyId: A.companyId,
        companySlug: A.slug,
        companyName: "MCX",
        email: "nhanvien.moi@legit.example.test",
        fullName: "Nguyễn Văn A",
        token: INVITE_TOKEN,
      });
    };

    /**
     * Kẻ ghi «ngoài app» sửa hàng bằng superuser (`direct` — bỏ qua 0591 có chủ ý), GIỮ id + envelope. Tiền điều
     * kiện ép ở đây cho MỌI ca (M21: WHERE trượt ra 0 hàng KHÔNG ném lỗi ⇒ thiếu assert thì ca xanh-rỗng): chạm
     * ĐÚNG 1 hàng, trường đổi đúng giá trị (`expectAfter`), id + envelope giữ nguyên từng byte.
     */
    const tamperAsSuperuser = async (
      setSql: string,
      params: unknown[],
      expectAfter: (after: StoredRow) => void,
    ) => {
      const before = await storedRow();
      const res = await direct.query(
        `UPDATE company_mail_configs SET ${setSql} WHERE company_id = $1 AND scope = 'default'`,
        [A.companyId, ...params],
      );
      expect(res.rowCount, "bước sửa hàng phải chạm đúng 1 hàng").toBe(1);
      const after = await storedRow();
      expectAfter(after);
      expect(after.id).toBe(before.id);
      expect(after.secret_ciphertext.equals(before.secret_ciphertext)).toBe(true);
      expect(after.encrypted_dek.equals(before.encrypted_dek)).toBe(true);
      return { before, after };
    };

    /**
     * Role APP (withTenant) DELETE rồi INSERT chép NGUYÊN 7 cột envelope sang hàng mang `id`/`port` cho trước —
     * đúng đường hồi quy WO nêu (0591 chỉ thu hồi UPDATE). `rowCount` 1 cho CẢ HAI câu (M23) + đọc lại.
     */
    const reinsertAsApp = async (over: { id: string; port: number }) => {
      const snap = await direct.query(
        `SELECT * FROM company_mail_configs WHERE company_id = $1 AND scope = 'default'`,
        [A.companyId],
      );
      expect(snap.rows, "phải có đúng 1 hàng để chép").toHaveLength(1);
      const o = snap.rows[0];
      const counts = await app.get(DatabaseService).withTenant(A.companyId, async (tx) => {
        const del = await tx.execute(
          sql`DELETE FROM company_mail_configs WHERE company_id = ${A.companyId} AND scope = 'default'`,
        );
        const ins = await tx.execute(sql`INSERT INTO company_mail_configs
            (id, company_id, scope, host, port, username, secure, from_name, from_email,
             secret_ciphertext, encrypted_dek, dek_key_version, kms_key_id, iv_nonce, auth_tag, enc_algo)
          VALUES (${over.id}, ${o.company_id}, ${o.scope}, ${o.host}, ${over.port}, ${o.username}, ${o.secure},
             ${o.from_name}, ${o.from_email}, ${o.secret_ciphertext}, ${o.encrypted_dek}, ${o.dek_key_version},
             ${o.kms_key_id}, ${o.iv_nonce}, ${o.auth_tag}, ${o.enc_algo})`);
        return { del: del.rowCount, ins: ins.rowCount };
      });
      expect(counts.del, "DELETE phải xoá đúng 1 hàng").toBe(1);
      expect(counts.ins, "INSERT phải chèn đúng 1 hàng").toBe(1);
      const after = await storedRow();
      expect(after.id).toBe(over.id);
      expect(after.port).toBe(over.port);
      expect(after.secret_ciphertext.equals(o.secret_ciphertext as Buffer)).toBe(true);
      expect(after.encrypted_dek.equals(o.encrypted_dek as Buffer)).toBe(true);
      return { beforeId: o.id as string, after };
    };

    /** Mỗi trường đích đổi MỘT MÌNH (giữ id + envelope); `dest` = đích MỚI của hàng sau khi sửa. */
    const tamperOf = (column: keyof Destination, value: () => unknown) => ({
      setSql: `${column} = $2`,
      value,
      dest: () => ({ ...legitDest(), [column]: value() }) as Destination,
    });
    const DEST_TAMPERS: Array<[string, ReturnType<typeof tamperOf>]> = [
      ["port → E", tamperOf("port", () => E.port)],
      ["username → tài khoản kẻ tấn công", tamperOf("username", () => EVIL_USER)],
      ["secure → true", tamperOf("secure", () => true)],
      ["host → localhost", tamperOf("host", () => "localhost")],
    ];

    it.each(DEST_TAMPERS)(
      "R-B1: superuser đổi %s, giữ id + envelope ⇒ test vắng password tới đích MỚI của hàng: {ok:false, câu nhập lại}, 0 kết nối L/E",
      async (_label, t) => {
        await tamperAsSuperuser(t.setSql, [t.value()], (after) =>
          expect(destOfRow(after)).toEqual(t.dest()),
        );

        const {
          result: res,
          L: toL,
          E: toE,
        } = await connectionsDuring(() => authPost("/settings/mail-config/test").send(t.dest()));

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data).toEqual({ ok: false, errorMessage: DECRYPT_MSG });
        expect(toL).toBe(0);
        expect(toE).toBe(0);
        expect(L.auths).toEqual([]);
        expect(E.auths).toEqual([]);
      },
    );

    it.each(DEST_TAMPERS)(
      "R-B2: superuser đổi %s, giữ id + envelope ⇒ lời mời {sent:false, reason:'decrypt_failed'}, 0 kết nối L/E",
      async (_label, t) => {
        await tamperAsSuperuser(t.setSql, [t.value()], (after) =>
          expect(destOfRow(after)).toEqual(t.dest()),
        );

        const { result: sent, L: toL, E: toE } = await connectionsDuring(() => sendInvite());

        expect(sent).toEqual({ sent: false, reason: "decrypt_failed" });
        expect(toL).toBe(0);
        expect(toE).toBe(0);
        expect(L.auths).toEqual([]);
        expect(E.auths).toEqual([]);
      },
    );

    it("R-B4: role app DELETE+INSERT tái dùng id + chép envelope, port → E ⇒ lời mời decrypt_failed · test vắng password {ok:false, câu nhập lại} · E 0 kết nối", async () => {
      const before = await storedRow();
      await reinsertAsApp({ id: before.id, port: E.port });

      const invite = await connectionsDuring(() => sendInvite());
      const test = await connectionsDuring(() =>
        authPost("/settings/mail-config/test").send({ ...legitDest(), port: E.port }),
      );

      expect(invite.result).toEqual({ sent: false, reason: "decrypt_failed" });
      expect(test.result.status, JSON.stringify(test.result.body)).toBe(201);
      expect(test.result.body.data).toEqual({ ok: false, errorMessage: DECRYPT_MSG });
      expect([invite.L, invite.E, test.L, test.E]).toEqual([0, 0, 0, 0]);
      expect(E.auths).toEqual([]);
    });

    it("R-B6: role app chép envelope sang hàng id MỚI, CÙNG đích ⇒ lời mời decrypt_failed (id là một phần ngữ cảnh)", async () => {
      const { beforeId, after } = await reinsertAsApp({ id: randomUUID(), port: L.port });
      expect(after.id, "tiền điều kiện: id phải đổi").not.toBe(beforeId);
      expect(destOfRow(after)).toEqual(legitDest());

      const { result: sent, L: toL } = await connectionsDuring(() => sendInvite());

      expect(sent).toEqual({ sent: false, reason: "decrypt_failed" });
      expect(toL).toBe(0);
      expect(L.auths).toEqual([]);
    });

    it("P-B2 (đối chứng dương của reinsertAsApp · ghim rủi ro tồn dư M28): role app DELETE+INSERT lại NGUYÊN ảnh chụp (cùng id + cùng đích + chép envelope) ⇒ lời mời {sent:true}, L nhận AUTH bằng mật khẩu đã lưu", async () => {
      // Bản chép giữ envelope nguyên vẹn ⇒ R-B4/R-B6 đỏ vì NGỮ CẢNH, không vì bản chép hỏng. Ghim rủi ro tồn dư
      // CHẤP NHẬN (plan §7, M28): KHÔNG chống phát lại — thêm độ tươi thì đổi ca này + docblock có chủ đích.
      const before = await storedRow();
      await reinsertAsApp({ id: before.id, port: L.port });

      const invite = await connectionsDuring(() => sendInvite());

      expect(invite.result).toEqual({ sent: true });
      expect(L.auths).toEqual([
        expect.objectContaining({ username: LEGIT_USER, password: SMTP_PW_STORED }),
      ]);
      expect(invite.E).toBe(0);
    });

    it("P-B1 (đối chứng dương): superuser CHỈ đổi from_name/from_email/updated_at ⇒ lời mời {sent:true} + test vắng password {ok:true}, L nhận AUTH bằng mật khẩu đã lưu", async () => {
      // Không gắn quá tay: from_* / updated_at không phải ĐÍCH của mật khẩu (PUT «chỉ đổi người gửi» giữ envelope).
      await tamperAsSuperuser(
        "from_name = $2, from_email = $3, updated_at = now() - interval '1 day'",
        ["Ban Kiểm soát", "bks@legit.example.test"],
        (after) => {
          expect(after.from_name).toBe("Ban Kiểm soát");
          expect(destOfRow(after)).toEqual(legitDest());
        },
      );

      const invite = await connectionsDuring(() => sendInvite());
      const test = await connectionsDuring(() =>
        authPost("/settings/mail-config/test").send(legitDest()),
      );

      expect(invite.result).toEqual({ sent: true });
      // from_email đổi THẬT (thư đi bằng địa chỉ mới) — bước sửa hàng không trượt.
      expect(L.messages.map((m) => m.mailFrom)).toEqual(["bks@legit.example.test"]);
      expect(test.result.status, JSON.stringify(test.result.body)).toBe(201);
      expect(test.result.body.data).toEqual({ ok: true });
      expect(L.auths).toEqual([
        expect.objectContaining({ username: LEGIT_USER, password: SMTP_PW_STORED }),
        expect.objectContaining({ username: LEGIT_USER, password: SMTP_PW_STORED }),
      ]);
      // `E.connections` cộng dồn cả file (P3 kết nối E) ⇒ đo TRONG phần act.
      expect([invite.E, test.E]).toEqual([0, 0]);
    });

    it.each([
      ["host", () => ({ host: `a${LONE_SURROGATE}b.test` })],
      ["username", () => ({ username: `mailer${LONE_SURROGATE}@legit.example.test` })],
    ] as const)(
      "R-B5: PUT có password mà %s chứa surrogate lẻ (PG lưu U+FFFD ≠ giá trị đã gắn) ⇒ 400 VALIDATION-ERR-001; hàng + audit y nguyên",
      async (_field, over) => {
        const before = await storedRow();
        const auditBefore = await mailAuditCount();
        expect(auditBefore, "bộ đếm audit phải thấy các lần PUT trước").toBeGreaterThan(0);

        const res = await putStored({ ...over(), password: SMTP_PW_ROTATED });

        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.body.error?.code).toBe(VALIDATION_ERROR);
        expect(res.body.error?.message).toBe(NOT_PERSISTED_MSG);
        const after = await storedRow();
        expect(after.id).toBe(before.id);
        expect(destOfRow(after)).toEqual(legitDest());
        expect(after.secret_ciphertext.equals(before.secret_ciphertext)).toBe(true);
        expect(await mailAuditCount()).toBe(auditBefore);
      },
    );

    it("R-B7: repo.upsert với recordId CHỮ HOA (PG trả uuid chữ thường ≠ id đã gắn vào ngữ cảnh) ⇒ REJECT lỗi lập trình; hàng + audit y nguyên", async () => {
      const before = await storedRow();
      const auditBefore = await mailAuditCount();
      expect(auditBefore, "bộ đếm audit phải thấy các lần PUT trước").toBeGreaterThan(0);
      const upperId = randomUUID().toUpperCase();
      const envelope = await app.get(SecretEncryptionService).encryptSecret(SMTP_PW_ROTATED, {
        companyId: A.companyId,
        recordId: JSON.stringify([upperId, LOCALHOST, L.port, LEGIT_USER, false]),
        purpose: "smtp_password",
      });

      const attempt = app
        .get(MailConfigRepository)
        .upsert(
          A.companyId,
          upperId,
          { scope: "default", ...legitDest(), fromName: null, fromEmail: FROM_EMAIL },
          envelope,
          { audit: app.get(AuditService), actorUserId: adminUserId },
        );

      await expect(attempt).rejects.toThrow(/recordId/);
      const err = (await attempt.catch((e: unknown) => e)) as Error;
      expect(err.name, "lỗi LẬP TRÌNH (500), không phải lỗi miền 400").not.toBe(
        "MailDestinationNotPersistedError",
      );
      expect(err.message).not.toContain(upperId);
      expect(err.message).not.toContain(upperId.toLowerCase());
      const after = await storedRow();
      expect(after.id).toBe(before.id);
      expect(after.secret_ciphertext.equals(before.secret_ciphertext)).toBe(true);
      expect(await mailAuditCount()).toBe(auditBefore);
    });

    it.each([
      ["host", () => ({ host: `a${LONE_SURROGATE}b.test` })],
      ["username", () => ({ username: `mailer${LONE_SURROGATE}@legit.example.test` })],
    ] as const)(
      "R-B5b: CHƯA có hàng (nhánh INSERT MỚI — đường cấu hình ĐẦU TIÊN của PROD), PUT có password mà %s chứa surrogate lẻ ⇒ 400 VALIDATION-ERR-001; vẫn 0 hàng; audit y nguyên",
      async (_field, over) => {
        const auditBefore = await mailAuditCount();
        expect(auditBefore, "bộ đếm audit phải thấy các lần PUT trước").toBeGreaterThan(0);
        // Bỏ hàng của beforeEach bằng superuser ⇒ PUT đi nhánh INSERT mới (R-B5 chỉ chạm nhánh DELETE+INSERT).
        const del = await direct.query(
          `DELETE FROM company_mail_configs WHERE company_id = $1 AND scope = 'default'`,
          [A.companyId],
        );
        expect(del.rowCount, "bước xoá hàng phải chạm đúng 1 hàng").toBe(1);
        expect(await configCount(), "tiền điều kiện: công ty chưa có cấu hình nào").toBe(0);

        const res = await putStored({ ...over(), password: SMTP_PW_ROTATED });

        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.body.error?.code).toBe(VALIDATION_ERROR);
        expect(res.body.error?.message).toBe(NOT_PERSISTED_MSG);
        expect(await configCount()).toBe(0);
        expect(await mailAuditCount()).toBe(auditBefore);
      },
    );

    it("R-B8: repo.upsert với companyId CHỮ HOA (PG lưu company_id chữ thường ≠ companyId đã gắn vào ngữ cảnh) ⇒ REJECT lỗi lập trình; hàng + audit y nguyên", async () => {
      const before = await storedRow();
      const auditBefore = await mailAuditCount();
      expect(auditBefore, "bộ đếm audit phải thấy các lần PUT trước").toBeGreaterThan(0);
      const upperCompany = A.companyId.toUpperCase();
      expect(upperCompany, "tiền điều kiện: có chữ cái để đổi hoa").not.toBe(A.companyId);
      // Tiền điều kiện: withTenant + RLS CHẤP NHẬN companyId chữ hoa (zod uuid không phân biệt hoa/thường; RLS ép
      // `::uuid`) — thiếu nó, ca có thể đỏ vì InvalidCompanyIdError (message cũng chứa "companyId") thay vì B4.
      const seen = await app.get(MailConfigRepository).findByScope(upperCompany, "default");
      expect(seen?.id, "withTenant(chữ hoa) đọc được hàng của chính công ty").toBe(before.id);
      expect(seen?.companyId, "PG trả company_id chữ thường").toBe(A.companyId);
      const recordId = randomUUID();
      // Envelope gắn đúng chuỗi companyId CHỮ HOA — y như một caller tương lai lấy companyId không chuẩn hoá.
      const envelope = await app.get(SecretEncryptionService).encryptSecret(SMTP_PW_ROTATED, {
        companyId: upperCompany,
        recordId: JSON.stringify([recordId, LOCALHOST, L.port, LEGIT_USER, false]),
        purpose: "smtp_password",
      });

      const attempt = app
        .get(MailConfigRepository)
        .upsert(
          upperCompany,
          recordId,
          { scope: "default", ...legitDest(), fromName: null, fromEmail: FROM_EMAIL },
          envelope,
          { audit: app.get(AuditService), actorUserId: adminUserId },
        );

      await expect(attempt).rejects.toThrow(/companyId gắn vào ngữ cảnh/);
      const err = (await attempt.catch((e: unknown) => e)) as Error;
      expect(err.name, "lỗi LẬP TRÌNH (500), không phải 400").not.toBe(
        "MailDestinationNotPersistedError",
      );
      expect(err.message.toLowerCase()).not.toContain(A.companyId);
      const after = await storedRow();
      expect(after.id).toBe(before.id);
      expect(after.secret_ciphertext.equals(before.secret_ciphertext)).toBe(true);
      expect(await mailAuditCount()).toBe(auditBefore);
    });
  },
);
