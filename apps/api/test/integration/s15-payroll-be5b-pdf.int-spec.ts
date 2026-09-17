/**
 * S15-PAYROLL-BE-5B — PDF phiếu lương 083 (người khác) · 084 (của mình) — plan §4 mục 1–2 + §0b.
 *
 * Mỗi ca DENY có ca ALLOW đối chứng cùng route (memory `deny-cases-vacuous-without-allow-case`).
 *  · 083: thiếu `export:payroll` / thiếu `view-payslip` / cặp @Department ⇒ 403 · phiếu tenant B ⇒ 404 · 0 audit
 *    mọi ca deny · ALLOW đúng 1 audit/lượt · gọi lại dùng lại tệp sống (không sinh PDF mới).
 *  · 084: phiếu người khác ⇒ 404 010 · kỳ `Approved` ⇒ 404 · kỳ ĐÚNG `Published` + kỳ `Locked` ⇒ 200 · có
 *    `view-payslip` mà thiếu `view-own-payslip` ⇒ 403 · 0 audit kể cả ALLOW.
 *  · PDF tải THẬT từ MinIO, đọc lại văn bản có dấu (DECISIONS-14 §6.2); hàng tệp tạm + link + access log;
 *    `expiresAt` = hạn chữ ký thật (`X-Amz-Expires`).
 *  · Route file chung `/foundation/files/*` ⇒ 403 cho người giữ quyền FOUNDATION (resolver PAYROLL).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5) + object storage đã cấu hình.
 */
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { inspectPdf, normalizePdfText } from "../helpers/pdf-text";
import {
  employeeProfile,
  grantAllPayrollPairs,
  grantPayrollPairs,
  publishedPeriodWithPayslips,
} from "../helpers/payroll-v2-fixtures";
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

const hasStorage = !!process.env.S3_ENDPOINT && !!process.env.S3_BUCKET;
const hasLaneDb = hasDb && !!process.env.LANE_DB && hasStorage;
const LOGIN_PW = loginPasswordFixture("s15payrollbe5bpdf");
const EMP_NAME = "Nguyễn Thị Ánh Tuyết";

type Actor = { id: string; token: string };

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-5B · PDF 083/084", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;
  let B: SeededTenant;
  let officer: Actor;
  let noExport: Actor;
  let noPayslip: Actor;
  let dept: Actor;
  let emp: Actor;
  let other: Actor;
  let adminOnlyPayslip: Actor;
  let fileAdmin: Actor;
  let payslipPublished = "";
  let payslipLocked = "";
  let payslipApproved = "";
  let payslipOther = "";
  let payslipB = "";

  const http = () => request(app.getHttpServer());
  const get = (token: string, url: string) =>
    http().get(url).set("Authorization", `Bearer ${token}`);
  async function login(t: SeededTenant, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }
  const exportAudits = async (actorId: string): Promise<number> =>
    Number(
      (
        await direct.query(
          `SELECT count(*)::int AS n FROM audit_logs
            WHERE company_id = $1 AND actor_user_id = $2 AND object_type = 'payslip' AND action = 'export'`,
          [A.companyId, actorId],
        )
      ).rows[0].n,
    );
  /** Mọi audit NGOÀI vết đăng nhập (`auth`) của actor. */
  const anyAudits = async (actorId: string): Promise<number> =>
    Number(
      (
        await direct.query(
          `SELECT count(*)::int AS n FROM audit_logs
            WHERE company_id = $1 AND actor_user_id = $2 AND object_type <> 'auth'`,
          [A.companyId, actorId],
        )
      ).rows[0].n,
    );
  const fetchBytes = async (url: string): Promise<Uint8Array> => {
    const res = await fetch(url);
    expect(res.status, `tải ${url.split("?")[0]}`).toBe(200);
    return new Uint8Array(await res.arrayBuffer());
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    const tag = randomUUID().slice(0, 4);

    A = await seedCompany(direct, "be5bpdf");
    B = await seedCompany(direct, "be5bpdfb");
    companyIds.push(A.companyId, B.companyId);
    // KHÔNG đổi `companies.name`: lọc `NOT_FIXTURE_TENANT` (`c.name = 'Company ' || c.slug`) của các spec bất biến
    // chạy song song dựa vào tên gốc để loại tenant fixture. Chữ có dấu của tên công ty đã phủ ở unit
    // `payslip-pdf.document.spec.ts`.

    const mk = async (t: SeededTenant, label: string, grant: (id: string) => Promise<void>) => {
      const email = `${label}@${t.slug}.test`;
      const id = await seedUser(direct, t.companyId, email, hash);
      await grant(id);
      return { id, token: await login(t, email) };
    };
    officer = await mk(A, "officer", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, `b5b-off-${tag}`),
    );
    const approver = await seedUser(direct, A.companyId, `approver@${A.slug}.test`, hash);
    noExport = await mk(A, "noexport", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `b5b-nx-${tag}`, ["payslipPdf"]),
    );
    noPayslip = await mk(A, "nopayslip", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `b5b-np-${tag}`, ["periodExport"]),
    );
    dept = await mk(A, "dept", (id) =>
      grantPayrollPairs(
        direct,
        A.companyId,
        id,
        `b5b-dp-${tag}`,
        ["payslipPdf", "periodExport"],
        "Department",
      ),
    );
    emp = await mk(A, "emp", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `b5b-emp-${tag}`, ["mePayslipPdf"], "Own"),
    );
    other = await mk(A, "other", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `b5b-oth-${tag}`, ["mePayslipPdf"], "Own"),
    );
    adminOnlyPayslip = await mk(A, "adminonly", (id) =>
      grantPayrollPairs(direct, A.companyId, id, `b5b-ao-${tag}`, ["payslipPdf", "periodExport"]),
    );
    fileAdmin = await mk(A, "fileadmin", async (id) => {
      const roleId = await seedRole(direct, A.companyId, `b5b-file-${tag}`);
      for (const action of ["view", "download", "delete", "unlink"]) {
        const permId = await seedPermissionCatalog(direct, action, "foundation-file", false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, id, roleId, A.companyId);
    });

    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [emp.id, EMP_NAME]);
    await employeeProfile(direct, A.companyId, emp.id, "NV-0042", null);

    const pub = await publishedPeriodWithPayslips(direct, A.companyId, {
      month: "2093-03",
      payees: [
        { userId: emp.id, net: "19064999.49", gross: "19999999.99" },
        { userId: other.id, net: "7000000.00" },
      ],
      officerId: officer.id,
      approverId: approver,
    });
    payslipPublished = pub.payslipIdByUser.get(emp.id) ?? "";
    payslipOther = pub.payslipIdByUser.get(other.id) ?? "";
    await direct.query(
      `INSERT INTO payslip_items (company_id, payslip_id, item_type, label, amount, sort_order)
       VALUES ($1, $2, 'earning', 'Lương cơ bản', 19999999.99, 1),
              ($1, $2, 'deduction', 'Bảo hiểm xã hội (8%)', -1599999.99, 2),
              ($1, $2, 'adjustment', 'Điều chỉnh: truy thu tháng trước', -125000.00, 3)`,
      [A.companyId, payslipPublished],
    );
    const locked = await publishedPeriodWithPayslips(direct, A.companyId, {
      month: "2093-02",
      payees: [{ userId: emp.id, net: "5000000.00" }],
      officerId: officer.id,
      approverId: approver,
      status: "Locked",
    });
    payslipLocked = locked.payslipIdByUser.get(emp.id) ?? "";
    const approved = await publishedPeriodWithPayslips(direct, A.companyId, {
      month: "2093-04",
      payees: [{ userId: emp.id, net: "5000000.00" }],
      officerId: officer.id,
      approverId: approver,
      status: "Approved",
    });
    payslipApproved = approved.payslipIdByUser.get(emp.id) ?? "";

    const bOfficer = await seedUser(direct, B.companyId, `off@${B.slug}.test`, hash);
    const bApprover = await seedUser(direct, B.companyId, `app@${B.slug}.test`, hash);
    const bEmp = await seedUser(direct, B.companyId, `emp@${B.slug}.test`, hash);
    const pb = await publishedPeriodWithPayslips(direct, B.companyId, {
      month: "2093-03",
      payees: [{ userId: bEmp, net: "1000000.00" }],
      officerId: bOfficer,
      approverId: bApprover,
    });
    payslipB = pb.payslipIdByUser.get(bEmp) ?? "";
  }, 120_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═══ 083 — cổng ═══════════════════════════════════════════════════════════════════════════════

  it("083 DENY: thiếu `export:payroll` ⇒ 403, 0 audit", async () => {
    const res = await get(noExport.token, `/payslips/${payslipPublished}/pdf`);
    expect(res.status).toBe(403);
    expect(await anyAudits(noExport.id)).toBe(0);
  });

  it("083 DENY: thiếu `view-payslip` ⇒ 403, 0 audit", async () => {
    const res = await get(noPayslip.token, `/payslips/${payslipPublished}/pdf`);
    expect(res.status).toBe(403);
    expect(await anyAudits(noPayslip.id)).toBe(0);
  });

  it("083 DENY: cặp @Department ⇒ 403 (sàn Company), 0 audit", async () => {
    const res = await get(dept.token, `/payslips/${payslipPublished}/pdf`);
    expect(res.status).toBe(403);
    expect(await anyAudits(dept.id)).toBe(0);
  });

  it("083 DENY: phiếu của tenant B ⇒ 404 010, 0 audit", async () => {
    const res = await get(officer.token, `/payslips/${payslipB}/pdf`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
    expect(await exportAudits(officer.id)).toBe(0);
  });

  it("083 ALLOW: PDF thật đọc lại đúng chữ có dấu + số snapshot; hàng tệp tạm + link + log; 1 audit", async () => {
    const before = Date.now();
    const res = await get(adminOnlyPayslip.token, `/payslips/${payslipPublished}/pdf`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const dto = res.body.data as {
      fileId: string;
      fileName: string;
      url: string;
      expiresAt: string;
    };
    expect(dto.fileName).toBe("phieu-luong-2093-03.pdf");
    expect(await exportAudits(adminOnlyPayslip.id)).toBe(1);

    // expiresAt = hạn CHỮ KÝ thật (vá bug presignTtlSec).
    const signedTtl = Number(new URL(dto.url).searchParams.get("X-Amz-Expires"));
    const expiresMs = new Date(dto.expiresAt).getTime();
    expect(Math.abs(expiresMs - (before + signedTtl * 1000))).toBeLessThan(10_000);

    const pdf = await inspectPdf(await fetchBytes(dto.url));
    const text = normalizePdfText(pdf.text);
    expect(pdf.hasEmbeddedRoboto).toBe(true);
    // Slug fixture có dấu gạch ⇒ pdfmake được phép ngắt dòng sau «-» và bản trích chèn khoảng trắng ở đó
    // (tuỳ độ rộng slug ngẫu nhiên) ⇒ so tên công ty KHÔNG tính khoảng trắng.
    expect(text.replace(/\s+/g, "")).toContain(`Company${A.slug}`);
    for (const needle of [
      "PHIẾU LƯƠNG THÁNG 03/2093",
      EMP_NAME,
      "NV-0042",
      "Bảo hiểm xã hội (8%)",
      "Điều chỉnh: truy thu tháng trước",
      "-1.599.999,99",
      "19.064.999,49 VND",
    ]) {
      expect(text).toContain(needle);
    }
    // Tên tệp hiển thị không mang danh tính người.
    expect(dto.fileName).not.toContain("NV-0042");

    const file = (
      await direct.query(
        `SELECT f.is_temporary, f.upload_status, f.expires_at, f.uploaded_by, f.owner_user_id, f.mime_type,
                l.module_code, l.entity_type, l.entity_id, l.link_type
           FROM files f JOIN file_links l ON l.file_id = f.id AND l.deleted_at IS NULL
          WHERE f.company_id = $1 AND f.id = $2`,
        [A.companyId, dto.fileId],
      )
    ).rows;
    expect(file).toHaveLength(1);
    expect(file[0]).toMatchObject({
      is_temporary: true,
      upload_status: "Uploaded",
      uploaded_by: adminOnlyPayslip.id,
      owner_user_id: adminOnlyPayslip.id,
      mime_type: "application/pdf",
      module_code: "PAYROLL",
      entity_type: "payslip-pdf",
      entity_id: payslipPublished,
      link_type: "Export",
    });
    const ttl = (new Date(file[0].expires_at).getTime() - before) / 1000;
    expect(ttl).toBeGreaterThan(850);
    expect(ttl).toBeLessThan(960);
    const logs = (
      await direct.query(
        `SELECT action FROM file_access_logs WHERE company_id = $1 AND file_id = $2 ORDER BY created_at`,
        [A.companyId, dto.fileId],
      )
    ).rows.map((r) => r.action);
    expect(logs).toEqual(["Upload", "GenerateSignedUrl"]);
  });

  it("083 gọi lại ⇒ DÙNG LẠI tệp sống (không sinh PDF mới) nhưng VẪN audit lượt đó", async () => {
    const first = await get(officer.token, `/payslips/${payslipOther}/pdf`);
    const second = await get(officer.token, `/payslips/${payslipOther}/pdf`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.fileId).toBe(first.body.data.fileId);
    expect(await exportAudits(officer.id)).toBe(2);
    const files = await direct.query(
      `SELECT count(*)::int AS n FROM files f JOIN file_links l ON l.file_id = f.id
        WHERE f.company_id = $1 AND l.entity_id = $2 AND f.uploaded_by = $3`,
      [A.companyId, payslipOther, officer.id],
    );
    expect(files.rows[0].n).toBe(1);
  });

  it("Route file chung: người giữ quyền FOUNDATION bị 403 trên tệp PAYROLL (metadata · download · xoá)", async () => {
    const res = await get(officer.token, `/payslips/${payslipPublished}/pdf`);
    const fileId = res.body.data.fileId as string;
    const meta = await get(fileAdmin.token, `/foundation/files/${fileId}`);
    const dl = await get(fileAdmin.token, `/foundation/files/${fileId}/download-url`);
    const del = await http()
      .delete(`/foundation/files/${fileId}`)
      .set("Authorization", `Bearer ${fileAdmin.token}`);
    expect([meta.status, dl.status, del.status]).toEqual([403, 403, 403]);
    // Đối chứng ALLOW: cùng người, route chung vẫn sống (danh sách metadata) ⇒ 403 ở trên là do resolver.
    const list = await get(fileAdmin.token, `/foundation/files?page=1&limit=5`);
    expect(list.status).toBe(200);
    const still = await direct.query(`SELECT deleted_at FROM files WHERE id = $1`, [fileId]);
    expect(still.rows[0].deleted_at).toBeNull();
  });

  // ═══ 084 — Own ════════════════════════════════════════════════════════════════════════════════

  it("084 ALLOW: kỳ ĐÚNG `Published` ⇒ 200 + PDF đúng người; 0 audit (SPEC-11 §13.2 (c))", async () => {
    const res = await get(emp.token, `/me/payslips/${payslipPublished}/pdf`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const pdf = await inspectPdf(await fetchBytes(res.body.data.url as string));
    expect(normalizePdfText(pdf.text)).toContain(EMP_NAME);
    expect(await anyAudits(emp.id)).toBe(0);
  });

  it("084 ALLOW: kỳ `Locked` ⇒ 200", async () => {
    const res = await get(emp.token, `/me/payslips/${payslipLocked}/pdf`);
    expect(res.status).toBe(200);
  });

  it("084 DENY: kỳ `Approved` (chưa phát hành) ⇒ 404 010", async () => {
    const res = await get(emp.token, `/me/payslips/${payslipApproved}/pdf`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
  });

  it("084 DENY: phiếu của người khác ⇒ 404 010 (không 403), 0 tệp sinh ra", async () => {
    const res = await get(other.token, `/me/payslips/${payslipPublished}/pdf`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYROLL-ERR-010");
    const files = await direct.query(
      `SELECT count(*)::int AS n FROM files WHERE company_id = $1 AND uploaded_by = $2`,
      [A.companyId, other.id],
    );
    expect(files.rows[0].n).toBe(0);
    expect(await anyAudits(other.id)).toBe(0);
  });

  it("084 DENY: phiếu tenant B ⇒ 404", async () => {
    const res = await get(emp.token, `/me/payslips/${payslipB}/pdf`);
    expect(res.status).toBe(404);
  });

  it("084 DENY: có `view-payslip` nhưng thiếu `view-own-payslip` ⇒ 403", async () => {
    const res = await get(adminOnlyPayslip.token, `/me/payslips/${payslipPublished}/pdf`);
    expect(res.status).toBe(403);
  });
});
