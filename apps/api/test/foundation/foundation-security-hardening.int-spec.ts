/**
 * S1-QA-FND-1 (L3-qa-leak-appendonly) — Foundation SECURITY HARDENING consolidation (integration, DB
 * cô lập, app role + RLS + PermissionGuard + full HTTP pipeline THẬT).
 *
 * MỤC TIÊU lane: VERIFY + lấp lỗ hổng coverage vùng nhạy cảm (audit masking · public-settings leak ·
 * append-only) Ở TẦNG HTTP/DB end-to-end mà các spec đã-xanh KHÔNG phủ — KHÔNG nhân bản case đã xanh:
 *
 *   ĐÃ phủ ở nơi khác (chỉ tham chiếu, KHÔNG lặp):
 *     - audit-permission-deny.int-spec.ts  → Employee→403 · wildcard→403 · cross-tenant→404 (cổng quyền).
 *     - audit-write-shape.int-spec.ts       → mask-at-WRITE (token đổi 2 vế ⇒ không changed_fields).
 *     - settings-permission-leak.int-spec.ts→ getPublic/resolve qua SERVICE (không qua HTTP route/envelope).
 *     - file-security.int-spec.ts           → MIME-spoof · path-traversal · soft-delete · no storage_path.
 *     - audit-logs-appendonly + file-access-logs-appendonly → app role UPDATE/DELETE FAIL (mỗi bảng riêng).
 *
 *   NET-NEW ở file này (khoảng trống THẬT):
 *     H1 [QA06-DATA-002/006 / §18.4]  redact-at-READ qua HTTP: seed 1 hàng audit RAW chứa password_hash /
 *         refresh_token_hash / token / secret_ref / storage_path trong before/after/old_values/new_values/
 *         metadata/device_info → GET /foundation/audit-logs (+ /:id) bằng company-admin THẬT → envelope
 *         KHÔNG chứa BẤT KỲ giá trị secret nào; cấu trúc DTO KHÔNG vỡ (key giữ, value='***'). Đây là đường
 *         AuditQueryService.toDto() (redact-at-read, D5) — phủ cả hàng CŨ ghi TRƯỚC khi mask-at-write có.
 *     H2 [QA06-DATA-003 / §18.2-6]  public-settings leak qua HTTP: GET /foundation/settings/public →
 *         envelope CHỈ public-nonsensitive; KHÔNG is_sensitive=true value · KHÔNG secret_ref · KHÔNG raw
 *         secret · KHÔNG field "isSensitive"/"secretRef" lọt ra ngoài DTO.
 *     H3 [BẤT BIẾN #2]  append-only HỢP NHẤT 2 bảng trong 1 vòng ghi-rồi-update/delete: app role UPDATE &
 *         DELETE trên audit_logs VÀ file_access_logs đều FAIL (permission denied); INSERT/SELECT OK. (Sanity
 *         cross-table — không thay 2 file append-only chuyên biệt; chứng minh KHÔNG bảng nào trôi grant.)
 *
 * Gate CỨNG: hasDb && LANE_DB (memory: integration-test-lane-db-gate) — `.env` làm hasDb=true; thiếu
 * LANE_DB → đỏ-giả trên DB dev chung 'mediaos'. Chạy:
 *   bash scripts/lane-db-setup.sh qafnd1 --reset → export LANE_DB=mediaos_qafnd1 →
 *   pnpm --filter @mediaos/api exec vitest run apps/api/test/foundation/foundation-security-hardening.int-spec.ts
 *
 * Direct pool (superuser, bypass RLS) seed raw rows; HTTP đi qua app thật (guard + RLS + interceptor sống).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionService } from "../../src/permission/permission.service";
import { SettingRepository } from "../../src/foundation/settings/setting.repository";
import { SettingService } from "../../src/foundation/settings/setting.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";
/** company-admin (mig 0005) — có view:audit-log (mig 0340) + view/update:foundation-setting (mig 0435). */
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";

/** Gate cứng: chỉ chạy khi có Postgres THẬT VÀ trên DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

/**
 * SENTINEL secret values — KHÔNG phải secret thật, chỉ marker duy nhất để khẳng định KHÔNG lọt ra HTTP.
 * Mỗi giá trị gắn dưới 1 KEY nhạy cảm khác nhau để phủ mọi stem masker (password/token/secret/storage).
 */
const LEAK = {
  passwordHash: `LEAK-pwhash-${randomUUID().slice(0, 8)}`,
  refreshTokenHash: `LEAK-rthash-${randomUUID().slice(0, 8)}`,
  token: `LEAK-token-${randomUUID().slice(0, 8)}`,
  secretRef: `LEAK-secretref-${randomUUID().slice(0, 8)}`,
  storagePath: `LEAK-storagepath-${randomUUID().slice(0, 8)}`,
};
const ALL_LEAK_VALUES = Object.values(LEAK);

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

/**
 * Chèn 1 hàng audit RAW chứa secret trong MỌI cột diff/meta (direct pool, bypass RLS + bypass masker).
 * Mô phỏng hàng audit CŨ (ghi trước khi mask-at-write tồn tại) → ép redact-at-read phải che lúc đọc.
 */
async function insertLeakyAudit(direct: Pool, companyId: string, action: string): Promise<string> {
  const before = { password_hash: LEAK.passwordHash, name: "old-name" };
  const after = { password_hash: `${LEAK.passwordHash}-2`, name: "new-name" };
  const oldValues = { refresh_token_hash: LEAK.refreshTokenHash, role: "user" };
  const newValues = { token: LEAK.token, role: "admin" };
  const metadata = { secret_ref: LEAK.secretRef, reason: "seed" };
  const deviceInfo = { storage_path: LEAK.storagePath, browser: "chrome" };
  const r = await direct.query(
    `INSERT INTO audit_logs
       (company_id, action, object_type, before, after, old_values, new_values, metadata, device_info)
     VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      companyId,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      JSON.stringify(metadata),
      JSON.stringify(deviceInfo),
    ],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!runDb)(
  "S1-QA-FND-1 foundation security hardening (audit-mask · public-leak · append-only)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let appConnPool: Pool;
    let A: SeededTenant;
    let adminToken: string;
    let leakyAuditId: string;
    let leakyAction: string;
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();
      appConnPool = appPool();

      A = await seedCompany(direct, "sechard");
      companyIds.push(A.companyId);
      const pw = await new PasswordService().hash(PASSWORD);

      const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      leakyAction = `SECHARD-leak-${randomUUID().slice(0, 8)}`;
      leakyAuditId = await insertLeakyAudit(direct, A.companyId, leakyAction);

      // public-settings fixtures: 1 public-nonsensitive (visible), 1 public-SENSITIVE (must drop),
      // 1 secret-ref (must never leak). is_public=false dropped implicitly.
      await direct.query(
        `INSERT INTO company_settings
         (company_id, setting_key, setting_value, value_type, category, module_code, is_public, is_sensitive, is_encrypted, secret_ref, status)
       VALUES
         ($1,'sec.public.ok','"public-value-ok"'::jsonb,'String','General','SYSTEM', true,  false, false, NULL, 'Active'),
         ($1,'sec.public.sensitive',$2::jsonb,'String','General','SYSTEM', true,  true,  false, NULL, 'Active'),
         ($1,'sec.secret',$3::jsonb,'SecretRef','Mail','SYSTEM', false, true, true, $4, 'Active')`,
        [
          A.companyId,
          JSON.stringify(LEAK.token), // public+sensitive value — must be dropped from /public
          JSON.stringify(LEAK.secretRef), // secret value
          LEAK.secretRef, // secret_ref column
        ],
      );

      adminToken = await login(app, A.slug, adminEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await appConnPool?.end();
    });

    /** Run fn inside a transaction as app role (mediaos_app) with tenant GUC set. */
    async function asTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
      const c = await appConnPool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
        const r = await fn(c);
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // H1 — audit masking redact-at-READ over HTTP (QA06-DATA-002/006, §18.4)
    // ════════════════════════════════════════════════════════════════════════════════
    describe("H1 — audit-log HTTP response masks token/password/secret_ref/storage_path (redact-at-read)", () => {
      it("H1a — GET /foundation/audit-logs (list) → NO secret value anywhere in envelope; structure intact", async () => {
        const res = await api(app)
          .get(`/foundation/audit-logs?action=${leakyAction}`)
          .set("Authorization", `Bearer ${adminToken}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);

        const serialized = JSON.stringify(res.body);
        // NONE of the seeded secret sentinels may appear in the wire response.
        for (const leak of ALL_LEAK_VALUES) {
          expect(serialized, `secret '${leak}' leaked in audit list HTTP response`).not.toContain(
            leak,
          );
        }

        // The masked row IS returned (DTO not dropped) and non-sensitive fields are preserved.
        const rows = res.body.data.data as Array<Record<string, unknown>>;
        const row = rows.find((r) => r["action"] === leakyAction);
        expect(row, "leaky audit row must still be returned (masked, not dropped)").toBeTruthy();
        const before = row!["before"] as Record<string, unknown>;
        const after = row!["after"] as Record<string, unknown>;
        // Sensitive key kept but value redacted to '***'; non-sensitive sibling preserved.
        expect(before["password_hash"]).toBe("***");
        expect(before["name"]).toBe("old-name");
        expect(after["password_hash"]).toBe("***");
        expect(after["name"]).toBe("new-name");
        // oldValues/newValues/metadata/deviceInfo also masked.
        expect((row!["oldValues"] as Record<string, unknown>)["refresh_token_hash"]).toBe("***");
        expect((row!["newValues"] as Record<string, unknown>)["token"]).toBe("***");
        expect((row!["metadata"] as Record<string, unknown>)["secret_ref"]).toBe("***");
        expect((row!["deviceInfo"] as Record<string, unknown>)["storage_path"]).toBe("***");
        // Non-sensitive siblings survive (audit still useful).
        expect((row!["newValues"] as Record<string, unknown>)["role"]).toBe("admin");
      });

      it("H1b — GET /foundation/audit-logs/:id (detail) → same redaction; no secret leak", async () => {
        const res = await api(app)
          .get(`/foundation/audit-logs/${leakyAuditId}`)
          .set("Authorization", `Bearer ${adminToken}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const serialized = JSON.stringify(res.body);
        for (const leak of ALL_LEAK_VALUES) {
          expect(serialized, `secret '${leak}' leaked in audit detail HTTP response`).not.toContain(
            leak,
          );
        }
        const dto = res.body.data as Record<string, unknown>;
        expect((dto["before"] as Record<string, unknown>)["password_hash"]).toBe("***");
        expect((dto["metadata"] as Record<string, unknown>)["secret_ref"]).toBe("***");
      });
    });

    // ════════════════════════════════════════════════════════════════════════════════
    // H2 — public-settings leak guard (QA06-DATA-003, §18.2-6)
    //
    // PRODUCTION leak-guard sống ở SettingService.getPublic() — verify NÓ TRỰC TIẾP (đường thật, KHÔNG mock).
    // HTTP route /foundation/settings/public CHƯA mount ở build này: SettingsModule (foundation/settings) gom
    // vào FoundationModule + wire app.module = S1-FND-WIRE-1 (CHƯA land — app.module mount ./settings, KHÔNG
    // mount ./foundation/settings). H2c = runtime probe TỰ-KÍCH-HOẠT (ctx.skip nếu 404 → vé S1-FND-WIRE-1;
    // 200 → assert no-leak THẬT) + H2-gate ÉP RED khi route land lén.
    // ════════════════════════════════════════════════════════════════════════════════
    describe("H2 — settings/public returns ONLY public-nonsensitive (no secret/secret_ref/is_sensitive)", () => {
      const db = new DatabaseService();
      const permission = new PermissionService(new PermissionRepository(db));
      const svc = new SettingService(db, new SettingRepository(db), new AuditService(), permission);

      it("H2a — SettingService.getPublic: public-nonsensitive present; public-SENSITIVE + secret + secret_ref ALL dropped", async () => {
        const out = await svc.getPublic(A.companyId, {});
        // public-nonsensitive IS returned.
        expect(out["sec.public.ok"]).toBe("public-value-ok");
        // public-SENSITIVE dropped (is_sensitive=true ⇒ dropped even though is_public=true).
        expect(out["sec.public.sensitive"]).toBeUndefined();
        // secret (is_public=false) dropped.
        expect(out["sec.secret"]).toBeUndefined();

        // No secret sentinel + no metadata flag leaks through the safe map.
        const serialized = JSON.stringify(out);
        for (const leak of ALL_LEAK_VALUES) {
          expect(serialized, `secret '${leak}' leaked in getPublic`).not.toContain(leak);
        }
        expect(serialized).not.toContain("secret_ref");
        expect(serialized).not.toContain("secretRef");
        expect(serialized).not.toContain("is_sensitive");
        expect(serialized).not.toContain("isSensitive");
      });

      it("H2b — getPublic shape is a flat key→value map (no DTO metadata columns leak)", async () => {
        const out = await svc.getPublic(A.companyId, {});
        // Every value is a plain scalar/structure — never a row object carrying is_public/is_sensitive/secret_ref.
        for (const v of Object.values(out)) {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            const keys = Object.keys(v as Record<string, unknown>).map((k) => k.toLowerCase());
            expect(keys).not.toContain("issensitive");
            expect(keys).not.toContain("secretref");
            expect(keys).not.toContain("ispublic");
          }
        }
      });

      // H2c — GATE TỰ-KÍCH-HOẠT (probe route, KHÔNG it.skip chết — giống D6 audit-permission-deny:219-229).
      // Probe GET /foundation/settings/public:
      //   • 404/501 (route mount = S1-FND-WIRE-1 chưa land) ⇒ ctx.skip() runtime: skip-CÓ-VÉ, KHÔNG bịa pass.
      //   • 200 (WIRE-1 land + merge) ⇒ CHẠY assertion no-leak THẬT trên envelope HTTP — activate-now,
      //     không cần sửa tay. H2-gate (assert 404) phía dưới vẫn ÉP RED khi route land lén → buộc nhánh 200 chạy.
      it("H2c — GET /foundation/settings/public HTTP envelope no-leak [TỰ-KÍCH-HOẠT khi route live; nếu 404 → skip-có-vé S1-FND-WIRE-1]", async (ctx) => {
        const res = await api(app)
          .get(`/foundation/settings/public`)
          .set("Authorization", `Bearer ${adminToken}`);

        // Route chưa mount (SettingsModule chưa gom vào FoundationModule + wire = S1-FND-WIRE-1 'todo') ⇒ 404/501.
        // KHÔNG nghiệm thu được envelope HTTP ở cây này; skip-có-vé runtime (KHÔNG pass-câm, KHÔNG fail-giả).
        if (res.status === 404 || res.status === 501) {
          ctx.skip();
          return;
        }

        // ── Route ĐÃ live ⇒ assertion no-leak THẬT trên envelope HTTP ────────────────────
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const serialized = JSON.stringify(res.body);
        // KHÔNG giá trị secret sentinel nào lọt ra wire.
        for (const leak of ALL_LEAK_VALUES) {
          expect(
            serialized,
            `secret '${leak}' leaked in /foundation/settings/public HTTP envelope`,
          ).not.toContain(leak);
        }
        // Cũng KHÔNG lộ cờ metadata nhạy cảm / secret_ref qua envelope.
        expect(serialized).not.toContain("secret_ref");
        expect(serialized).not.toContain("secretRef");
        expect(serialized).not.toContain("is_sensitive");
        expect(serialized).not.toContain("isSensitive");
      });

      // FORCE-RED khi route "land lén": H2c đã TỰ-KÍCH-HOẠT khi route live (probe 200 → chạy assertion), nhưng
      // gate này là lớp dự phòng thứ 2 — nếu CI vô tình KHÔNG chạy H2c (file bị exclude/filter), gate vẫn ĐỎ
      // khi route mount (≠404) ⇒ phơi bày S1-FND-WIRE-1 đã land mà coverage HTTP no-leak chưa được chứng minh.
      it("H2-gate — route still un-mounted (S1-FND-WIRE-1 landed → H2c tự chạy assertion no-leak THẬT)", async () => {
        const res = await api(app)
          .get(`/foundation/settings/public`)
          .set("Authorization", `Bearer ${adminToken}`);
        expect(
          res.status,
          "/foundation/settings/public is now mounted — S1-FND-WIRE-1 landed: H2c now self-runs HTTP envelope no-leak assertions (this gate just flags the transition)",
        ).toBe(404);
      });
    });

    // ════════════════════════════════════════════════════════════════════════════════
    // H3 — append-only consolidation: audit_logs + file_access_logs (BẤT BIẾN #2)
    // ════════════════════════════════════════════════════════════════════════════════
    describe("H3 — app role append-only on audit_logs AND file_access_logs (UPDATE/DELETE FAIL, INSERT/SELECT OK)", () => {
      let auditRowId: string;
      let fileId: string;
      let falRowId: string;

      beforeAll(async () => {
        // Seed an audit row + a files row + a file_access_logs row via superuser (bypass grants).
        const a = await direct.query(
          `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'SECHARD-ao', 'company') RETURNING id`,
          [A.companyId],
        );
        auditRowId = a.rows[0].id as string;

        const uploader = await seedUser(
          direct,
          A.companyId,
          `ao-up-${randomUUID().slice(0, 8)}@a.test`,
        );
        const f = await direct.query(
          `INSERT INTO files
           (company_id, original_name, stored_name, mime_type, file_size_bytes,
            storage_provider, storage_path, visibility, upload_status, scan_status, uploaded_by)
         VALUES ($1, 'ao.pdf', $2, 'application/pdf', 1024,
                 'MinIO', $3, 'Private', 'Uploaded', 'NotRequired', $4)
         RETURNING id`,
          [
            A.companyId,
            `ao-stored-${randomUUID().slice(0, 8)}.pdf`,
            `${A.companyId}/files/${randomUUID()}`,
            uploader,
          ],
        );
        fileId = f.rows[0].id as string;

        const l = await direct.query(
          `INSERT INTO file_access_logs (company_id, file_id, actor_user_id, action, access_granted)
         VALUES ($1, $2, $3, 'Download', true) RETURNING id`,
          [A.companyId, fileId, uploader],
        );
        falRowId = l.rows[0].id as string;
      });

      it("H3a — INSERT via app role SUCCEEDS on both tables (GRANT SELECT,INSERT)", async () => {
        const auditIns = await asTenant(A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO audit_logs (action, object_type) VALUES ('SECHARD-ao-ins', 'company') RETURNING id`,
          );
          return r.rows[0].id as string;
        });
        expect(auditIns).toBeTruthy();

        const falIns = await asTenant(A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO file_access_logs (file_id, actor_user_id, action, access_granted)
           VALUES ($1, NULL, 'Preview', true) RETURNING id`,
            [fileId],
          );
          return r.rows[0].id as string;
        });
        expect(falIns).toBeTruthy();
      });

      it("H3b — UPDATE on audit_logs via app role is DENIED (append-only)", async () => {
        await expect(
          asTenant(A.companyId, async (c) => {
            await c.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [auditRowId]);
          }),
        ).rejects.toThrow(/permission denied/);
      });

      it("H3c — DELETE on audit_logs via app role is DENIED (append-only)", async () => {
        await expect(
          asTenant(A.companyId, async (c) => {
            await c.query(`DELETE FROM audit_logs WHERE id = $1`, [auditRowId]);
          }),
        ).rejects.toThrow(/permission denied/);
      });

      it("H3d — UPDATE on file_access_logs via app role is DENIED (append-only)", async () => {
        await expect(
          asTenant(A.companyId, async (c) => {
            await c.query(`UPDATE file_access_logs SET action = 'Upload' WHERE id = $1`, [
              falRowId,
            ]);
          }),
        ).rejects.toThrow(/permission denied/);
      });

      it("H3e — DELETE on file_access_logs via app role is DENIED (append-only)", async () => {
        await expect(
          asTenant(A.companyId, async (c) => {
            await c.query(`DELETE FROM file_access_logs WHERE id = $1`, [falRowId]);
          }),
        ).rejects.toThrow(/permission denied/);
      });

      it("H3f — SELECT via app role still works (read not revoked, rows survive tamper attempts)", async () => {
        const rows = await asTenant(A.companyId, async (c) => {
          const r = await c.query(`SELECT action FROM audit_logs WHERE id = $1`, [auditRowId]);
          return r.rows;
        });
        // The append-only row is untouched (action NOT 'tampered' — UPDATE was denied above).
        expect(rows).toHaveLength(1);
        expect(rows[0].action).toBe("SECHARD-ao");
      });
    });
  },
);
