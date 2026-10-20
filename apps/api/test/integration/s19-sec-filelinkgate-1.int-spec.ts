/**
 * S19-SEC-FILELINKGATE-1 — gắn tệp vào thực thể chỉ khi người gắn xem được tệp theo cùng một quyết định với
 * `GET /foundation/files/:id` (plan `docs/plans/S19-SEC-FILELINKGATE-1.md` §2 O-1 · §3 D-3 · §4).
 *
 * Bất biến đo ở đây:
 *   (1) mọi đường gắn (TASK · HR hồ sơ · HR hợp đồng · FOUNDATION) tạo liên kết ⇔ người gắn xem được tệp;
 *       từ chối ⇒ 403, +0 liên kết, +0 audit `FileLinked`, +1 dòng `file_access_logs` từ chối (Link/VIEW);
 *   (2) vị từ xem: ≥ 1 liên kết sống ⇒ AND mọi liên kết; 0 sống + chưa từng gắn ⇒ chủ tệp HOẶC fallback
 *       `view:foundation-file`; 0 sống + đã từng gắn ⇒ từ chối mọi người, kể cả chủ;
 *   (2b) ở biên gắn, vế fallback đòi thêm `download:foundation-file` (từ chối ⇒ dòng log Link/DOWNLOAD); vế
 *       chủ tệp và vế có liên kết sống chỉ hỏi xem;
 *   (3) cặp (module, entity) chưa đăng ký ⇒ 400 ở route FOUNDATION;
 *   (4) cùng người gọi (giữ cả xem lẫn tải): gắn 2xx ⇔ `GET /foundation/files/:id` = 200 (F-7).
 *
 * Fixture gieo bằng pool `direct` (không PUT storage). Mọi ca TỪ CHỐI có ALLOW đứng cạnh trên cùng route.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PasswordService } from "../../src/auth/password.service";
import { hasDb } from "../helpers/integration-db";
import {
  seedObjectGrant,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
} from "../helpers/seed";
import { bootQa1World, type Json, type Qa1World } from "../helpers/social-qa1-kit";
import { seedEmployee, seedTask } from "../helpers/task-file-seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;
const PAGE_LIMIT_MAX = 100;
const LOGIN_PW = ["Passw0rd", "flg19"].join("!");

type PairGrant = readonly [string, string];
const TASKER_PAIRS: readonly PairGrant[] = [
  ["read", "task"],
  ["file-upload", "task"],
];
const HR_PAIRS: readonly PairGrant[] = [
  ["file-upload", "employee"],
  ["file-view", "employee"],
];
const CONTRACT_PAIRS: readonly PairGrant[] = [
  ["view", "contract"],
  ["manage", "contract"],
];
const LINKER_PAIRS: readonly PairGrant[] = [["link", "foundation-file"], ...CONTRACT_PAIRS];
const VIEW_FILE: PairGrant = ["view", "foundation-file"];
const DOWNLOAD_FILE: PairGrant = ["download", "foundation-file"];
const VIEW_CODE = "FOUNDATION.FILE.VIEW";
const DOWNLOAD_CODE = "FOUNDATION.FILE.DOWNLOAD";

const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;
const rowsOf = (body: unknown): Json[] => {
  const d = (body as { data?: unknown }).data;
  if (Array.isArray(d)) return d as Json[];
  return (((d ?? {}) as { data?: unknown }).data ?? []) as Json[];
};

interface Snap {
  live: number;
  audit: number;
  denyView: number;
  denyDownload: number;
}

describe.skipIf(!hasLaneDb)(
  "S19-SEC-FILELINKGATE-1 · gắn tệp theo cùng quyết định xem từng tệp",
  () => {
    let w: Qa1World;
    const ids = new Map<string, string>();
    const tokens = new Map<string, string>();

    let taskT = "";
    let taskT2 = "";
    let employeeE = "";
    let contractTypeId = "";
    let contractC2 = "";

    const files: Record<string, string> = {};

    // ─── Fixture ──────────────────────────────────────────────────────────────

    async function makeUser(label: string, pairs: readonly PairGrant[]): Promise<string> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const userId = await seedUser(w.direct, w.A.companyId, `${label}@${w.A.slug}.test`, hash);
      if (pairs.length > 0) {
        const roleId = await seedRole(
          w.direct,
          w.A.companyId,
          `flg-${label}-${userId.slice(0, 8)}`,
        );
        for (const [action, resource] of pairs) {
          const permId = await seedPermissionCatalog(w.direct, action, resource, false);
          await seedRolePermission(w.direct, roleId, permId, "ALLOW", "Company");
        }
        await seedUserRole(w.direct, userId, roleId, w.A.companyId);
      }
      ids.set(label, userId);
      return userId;
    }

    async function login(label: string): Promise<void> {
      const res = await w
        .post(null, "/auth/login")
        .send({ companySlug: w.A.slug, email: `${label}@${w.A.slug}.test`, password: LOGIN_PW });
      expect(res.status, `login ${label}: ${JSON.stringify(res.body)}`).toBe(200);
      tokens.set(label, dataOf(res.body).accessToken as string);
    }

    const tok = (label: string): string => tokens.get(label)!;
    const uid = (label: string): string => ids.get(label)!;
    const objectGrantIds: string[] = [];

    /** Hàng tệp Uploaded + Clean, chủ = `ownerId`. */
    async function seedFile(ownerId: string): Promise<string> {
      const id = randomUUID();
      await w.direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_extension,
                            file_size_bytes, storage_provider, storage_path, upload_status, scan_status,
                            owner_user_id, uploaded_by, uploaded_at)
         VALUES ($1,$2,$3,$4,'image/png','png',2048,'MinIO',$5,'Uploaded','Clean',$6,$6,now())`,
        [
          id,
          w.A.companyId,
          `flg-${id.slice(0, 8)}.png`,
          `stored-${id}`,
          `${w.A.companyId}/files/${id}`,
          ownerId,
        ],
      );
      return id;
    }

    async function insertLink(
      fileId: string,
      moduleCode: string,
      entityType: string,
      entityId: string,
      createdBy: string,
    ): Promise<string> {
      const r = await w.direct.query<{ id: string }>(
        `INSERT INTO file_links (company_id, file_id, module_code, entity_type, entity_id, link_type,
                                 sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,'Attachment',0,$6) RETURNING id`,
        [w.A.companyId, fileId, moduleCode, entityType, entityId, createdBy],
      );
      return r.rows[0]!.id;
    }

    /** Tệp có 1 liên kết sống tới một bài không tồn tại ⇒ resolver SOCIAL từ chối mọi người. */
    async function seedHiddenLinked(ownerId: string): Promise<string> {
      const id = await seedFile(ownerId);
      await insertLink(id, "SOCIAL", "feed_post", randomUUID(), ownerId);
      return id;
    }

    /** Tệp có liên kết duy nhất đã gỡ mềm ⇒ 0 liên kết sống, đã từng gắn. */
    async function seedRevoked(ownerId: string): Promise<string> {
      const id = await seedFile(ownerId);
      const linkId = await insertLink(id, "TASK", "task", taskT2, ownerId);
      await w.direct.query(
        `UPDATE file_links SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        [linkId, ownerId],
      );
      return id;
    }

    async function seedContract(): Promise<string> {
      const r = await w.direct.query<{ id: string }>(
        `INSERT INTO employee_contracts
           (company_id, employee_id, contract_type_id, contract_code, start_date, status)
         VALUES ($1, $2, $3, $4, '2025-01-01', 'Active') RETURNING id`,
        [w.A.companyId, employeeE, contractTypeId, `FLG-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0]!.id;
    }

    async function count(sql: string, params: unknown[]): Promise<number> {
      const r = await w.direct.query<{ n: number }>(sql, params);
      return r.rows[0]!.n;
    }

    const denyLinkLogs = (fileId: string, permissionCode: string) =>
      count(
        `SELECT count(*)::int AS n FROM file_access_logs
          WHERE file_id = $1 AND action = 'Link' AND access_granted = false
            AND permission_code = $2`,
        [fileId, permissionCode],
      );

    /** Lý do của dòng log từ chối Link mới nhất — phân biệt quyết định thật của liên kết với lối tắt thiếu resolver. */
    const lastLinkDenyReason = async (fileId: string): Promise<string | null> => {
      const r = await w.direct.query<{ denied_reason: string | null }>(
        `SELECT denied_reason FROM file_access_logs
          WHERE file_id = $1 AND action = 'Link' AND access_granted = false
          ORDER BY created_at DESC LIMIT 1`,
        [fileId],
      );
      return r.rows[0]?.denied_reason ?? null;
    };

    async function snap(fileId: string, entityId: string): Promise<Snap> {
      return {
        live: await count(
          `SELECT count(*)::int AS n FROM file_links WHERE file_id = $1 AND deleted_at IS NULL`,
          [fileId],
        ),
        audit: await count(
          `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'FileLinked' AND entity_id = $1`,
          [entityId],
        ),
        denyView: await denyLinkLogs(fileId, VIEW_CODE),
        denyDownload: await denyLinkLogs(fileId, DOWNLOAD_CODE),
      };
    }

    async function contractFileId(contractId: string): Promise<string | null> {
      const r = await w.direct.query<{ file_id: string | null }>(
        `SELECT file_id FROM employee_contracts WHERE id = $1`,
        [contractId],
      );
      return r.rows[0]!.file_id;
    }

    function expectDenied(
      res: { status: number; body: unknown },
      before: Snap,
      after: Snap,
      what: string,
    ): void {
      expect(res.status, `${what}: phải 403 — ${JSON.stringify(res.body)}`).toBe(403);
      expect(after.live, `${what}: không thêm liên kết nào`).toBe(before.live);
      expect(after.audit, `${what}: không có audit FileLinked mới`).toBe(before.audit);
      expect(after.denyView, `${what}: đúng 1 dòng log từ chối Link/FOUNDATION.FILE.VIEW`).toBe(
        before.denyView + 1,
      );
      expect(after.denyDownload, `${what}: không dòng log từ chối Link/DOWNLOAD`).toBe(
        before.denyDownload,
      );
    }

    function expectLinked(
      res: { status: number; body: unknown },
      before: Snap,
      after: Snap,
      what: string,
    ): void {
      expect(res.status, `${what}: phải 201 — ${JSON.stringify(res.body)}`).toBe(201);
      expect(after.live, `${what}: thêm đúng 1 liên kết`).toBe(before.live + 1);
    }

    const postTask = (label: string, taskId: string, fileId: string) =>
      w.post(tok(label), `/tasks/${taskId}/files`).send({ fileId });
    const postEmployee = (label: string, fileId: string) =>
      w.post(tok(label), `/hr/employees/${employeeE}/files`).send({ fileId, category: "CCCD" });
    const postContract = (label: string, contractId: string, fileId: string) =>
      w.post(tok(label), `/hr/contracts/${contractId}/file`).send({ fileId });
    const postFoundation = (label: string, fileId: string, body: Json) =>
      w.post(tok(label), `/foundation/files/${fileId}/links`).send(body);
    const contractTarget = (entityId: string): Json => ({
      moduleCode: "HR",
      entityType: "contract",
      entityId,
      linkType: "Contract",
    });

    beforeAll(async () => {
      w = await bootQa1World("filelink");

      await makeUser("stranger", []);
      await makeUser("tasker", TASKER_PAIRS);
      await makeUser("hrup", HR_PAIRS);
      await makeUser("ctr", CONTRACT_PAIRS);
      await makeUser("linker", LINKER_PAIRS);
      await makeUser("viewlinker", [...LINKER_PAIRS, VIEW_FILE, DOWNLOAD_FILE]);
      await makeUser("viewonly", [...LINKER_PAIRS, VIEW_FILE]);
      await makeUser("viewer", [VIEW_FILE]);
      for (const label of ["tasker", "hrup", "ctr", "linker", "viewlinker", "viewonly", "viewer"]) {
        await login(label);
      }

      taskT = await seedTask(w.direct, w.A.companyId, null);
      taskT2 = await seedTask(w.direct, w.A.companyId, null);
      employeeE = await seedEmployee(w.direct, w.A.companyId, null);
      const ct = await w.direct.query<{ id: string }>(
        `INSERT INTO contract_types (company_id, name, requires_end_date)
         VALUES ($1, $2, false) RETURNING id`,
        [w.A.companyId, `ct-${randomUUID().slice(0, 8)}`],
      );
      contractTypeId = ct.rows[0]!.id;
      contractC2 = await seedContract();

      const stranger = uid("stranger");
      files.otherT = await seedFile(stranger);
      files.otherH = await seedFile(stranger);
      files.otherC = await seedFile(stranger);
      files.otherF = await seedFile(stranger);
      files.otherF5 = await seedFile(stranger);
      files.fbView = await seedFile(stranger);
      files.ownT3 = await seedFile(uid("tasker"));
      files.andT = await seedFile(stranger);
      files.hid = await seedHiddenLinked(stranger);
      files.hidOwnT = await seedHiddenLinked(uid("tasker"));
      files.revT = await seedRevoked(uid("tasker"));
      files.revH = await seedRevoked(uid("hrup"));
      files.revC = await seedRevoked(uid("ctr"));
      files.revF = await seedRevoked(uid("linker"));
      files.revG = await seedRevoked(uid("viewlinker"));
      files.ownT = await seedFile(uid("tasker"));
      files.ownH = await seedFile(uid("hrup"));
      files.ownC = await seedFile(uid("ctr"));
      files.ownF = await seedFile(uid("linker"));
      files.ownF2 = await seedFile(uid("linker"));
      files.pub = await seedFile(stranger);
      await insertLink(files.pub, "TASK", "task", taskT2, stranger);
      // Hai liên kết sống: liên kết xem được chèn TRƯỚC liên kết không xem được.
      await insertLink(files.andT, "TASK", "task", taskT2, stranger);
      await insertLink(files.andT, "SOCIAL", "feed_post", randomUUID(), stranger);

      // Viewer giữ `view:foundation-file` nhưng có grant đối tượng DENY trên cả hai tệp G.
      // Grant ghi `granted_by` (người cấp thật) và bị xoá ở afterAll: lane dùng chung, các census
      // toàn lane chỉ đếm grant hệ thống (granted_by IS NULL) và không được thấy hàng của world này.
      files.gOwn = await seedFile(uid("viewer"));
      files.gOther = await seedFile(stranger);
      for (const g of [files.gOwn, files.gOther]) {
        const grantId = await seedObjectGrant(
          w.direct,
          w.A.companyId,
          uid("viewer"),
          "foundation-file",
          g,
          "view",
          "DENY",
        );
        await w.direct.query(`UPDATE object_permissions SET granted_by = $1 WHERE id = $2`, [
          stranger,
          grantId,
        ]);
        objectGrantIds.push(grantId);
      }
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      if (w && objectGrantIds.length > 0) {
        await w.direct.query(`DELETE FROM object_permissions WHERE id = ANY($1::uuid[])`, [
          objectGrantIds,
        ]);
      }
      await w?.close();
    });

    // ─── TASK ────────────────────────────────────────────────────────────────

    for (const [ca, key, what] of [
      ["K-1", "otherT", "tệp của người khác, 0 liên kết"],
      ["K-2", "hid", "tệp có liên kết người gắn không xem được"],
      ["K-2o", "hidOwnT", "tệp của chính người gắn nhưng đã có liên kết không xem được"],
      ["K-3", "revT", "tệp của chính người gắn, đã từng gắn, 0 liên kết sống"],
    ] as const) {
      it(`${ca} POST /tasks/:id/files — ${what} ⇒ 403, không gắn`, async () => {
        const before = await snap(files[key]!, taskT);
        const res = await postTask("tasker", taskT, files[key]!);
        expectDenied(res, before, await snap(files[key]!, taskT), ca);
      });
    }

    it("K-4 neo ALLOW: tệp của chính người gắn, chưa từng gắn ⇒ 201", async () => {
      const before = await snap(files.ownT!, taskT);
      const res = await postTask("tasker", taskT, files.ownT!);
      expectLinked(res, before, await snap(files.ownT!, taskT), "K-4");
    });

    it("K-5 neo ALLOW: tệp có liên kết người gắn xem được ⇒ 201, thành 2 liên kết", async () => {
      const before = await snap(files.pub!, taskT);
      const res = await postTask("tasker", taskT, files.pub!);
      const after = await snap(files.pub!, taskT);
      expectLinked(res, before, after, "K-5");
      expect(after.live).toBe(2);
    });

    it("K-6 tệp có hai liên kết sống — một xem được, một không ⇒ 403, không gắn (AND mọi liên kết)", async () => {
      const before = await snap(files.andT!, taskT);
      const res = await postTask("tasker", taskT, files.andT!);
      const after = await snap(files.andT!, taskT);
      expectDenied(res, before, after, "K-6");
      expect(after.live, "K-6: vẫn đúng 2 liên kết sống").toBe(2);
      expect(
        await lastLinkDenyReason(files.andT!),
        "K-6: từ chối phải đến từ quyết định của resolver trên liên kết, không phải lối tắt thiếu resolver",
      ).toBe("deny-resolver");
    });

    it("K-7 neo ALLOW: chủ tệp không giữ cặp foundation-file nào, chưa từng gắn ⇒ 201", async () => {
      const before = await snap(files.ownT3!, taskT);
      const res = await postTask("tasker", taskT, files.ownT3!);
      expectLinked(res, before, await snap(files.ownT3!, taskT), "K-7");
    });

    // ─── HR hồ sơ nhân viên ─────────────────────────────────────────────────

    for (const [ca, key, what] of [
      ["H-1", "otherH", "tệp của người khác, 0 liên kết"],
      ["H-2", "hid", "tệp có liên kết người gắn không xem được"],
      ["H-3", "revH", "tệp của chính người gắn, đã từng gắn"],
    ] as const) {
      it(`${ca} POST /hr/employees/:id/files — ${what} ⇒ 403, không gắn`, async () => {
        const before = await snap(files[key]!, employeeE);
        const res = await postEmployee("hrup", files[key]!);
        expectDenied(res, before, await snap(files[key]!, employeeE), ca);
      });
    }

    it("H-4 neo ALLOW: tệp của chính người gắn ⇒ 201", async () => {
      const before = await snap(files.ownH!, employeeE);
      const res = await postEmployee("hrup", files.ownH!);
      expectLinked(res, before, await snap(files.ownH!, employeeE), "H-4");
    });

    // ─── HR hợp đồng ────────────────────────────────────────────────────────

    for (const [ca, key, what] of [
      ["C-1", "otherC", "tệp của người khác, 0 liên kết"],
      ["C-2", "hid", "tệp có liên kết người gắn không xem được"],
      ["C-3", "revC", "tệp của chính người gắn, đã từng gắn"],
    ] as const) {
      it(`${ca} POST /hr/contracts/:id/file — ${what} ⇒ 403, file_id hợp đồng không đổi`, async () => {
        // Hợp đồng riêng mỗi ca: kết quả của ca trước không ảnh hưởng lý do đỏ/xanh của ca này.
        const contractId = await seedContract();
        const fileBefore = await contractFileId(contractId);
        const before = await snap(files[key]!, contractId);
        const res = await postContract("ctr", contractId, files[key]!);
        expectDenied(res, before, await snap(files[key]!, contractId), ca);
        expect(await contractFileId(contractId), `${ca}: file_id hợp đồng giữ nguyên`).toBe(
          fileBefore,
        );
      });
    }

    it("C-4 neo ALLOW: tệp của chính người gắn trên hợp đồng khác ⇒ 201, file_id trỏ tệp", async () => {
      const before = await snap(files.ownC!, contractC2);
      const res = await postContract("ctr", contractC2, files.ownC!);
      expectLinked(res, before, await snap(files.ownC!, contractC2), "C-4");
      expect(await contractFileId(contractC2)).toBe(files.ownC);
    });

    // ─── FOUNDATION ─────────────────────────────────────────────────────────

    for (const [ca, key, what] of [
      ["F-1", "otherF", "tệp của người khác, 0 liên kết"],
      ["F-2", "hid", "tệp có liên kết người gắn không xem được"],
      ["F-3", "revF", "tệp của chính người gắn, đã từng gắn"],
    ] as const) {
      it(`${ca} POST /foundation/files/:id/links — ${what} ⇒ 403 FORBIDDEN, không gắn`, async () => {
        const entityId = randomUUID();
        const before = await snap(files[key]!, entityId);
        const res = await postFoundation("linker", files[key]!, contractTarget(entityId));
        expectDenied(res, before, await snap(files[key]!, entityId), ca);
        expect(JSON.stringify(res.body)).toContain("FOUNDATION-FILE-ERR-FORBIDDEN");
      });
    }

    it("F-4 neo ALLOW: tệp của chính người gắn ⇒ 201", async () => {
      const entityId = randomUUID();
      const before = await snap(files.ownF!, entityId);
      const res = await postFoundation("linker", files.ownF!, contractTarget(entityId));
      expectLinked(res, before, await snap(files.ownF!, entityId), "F-4");
    });

    it("F-5 neo ALLOW: người gắn giữ view + download:foundation-file, tệp người khác chưa từng gắn ⇒ 201", async () => {
      const entityId = randomUUID();
      const before = await snap(files.otherF5!, entityId);
      const res = await postFoundation("viewlinker", files.otherF5!, contractTarget(entityId));
      expectLinked(res, before, await snap(files.otherF5!, entityId), "F-5");
    });

    it("F-10 cùng các cặp trừ download:foundation-file, tệp người khác chưa từng gắn ⇒ 403, không gắn", async () => {
      const get = await w.get(tok("viewonly"), `/foundation/files/${files.fbView}`);
      expect(get.status, `F-10: vẫn xem được tệp — ${JSON.stringify(get.body)}`).toBe(200);
      const entityId = randomUUID();
      const before = await snap(files.fbView!, entityId);
      const res = await postFoundation("viewonly", files.fbView!, contractTarget(entityId));
      const after = await snap(files.fbView!, entityId);
      expect(res.status, `F-10: phải 403 — ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain("FOUNDATION-FILE-ERR-FORBIDDEN");
      expect(after.live, "F-10: không thêm liên kết nào").toBe(before.live);
      expect(after.audit, "F-10: không có audit FileLinked mới").toBe(before.audit);
      expect(after.denyDownload, "F-10: đúng 1 dòng log từ chối Link/DOWNLOAD").toBe(
        before.denyDownload + 1,
      );
      expect(after.denyView, "F-10: không dòng log từ chối Link/VIEW").toBe(before.denyView);
    });

    it("F-6 cặp (module, entity) chưa đăng ký ⇒ 400 LINK, không gắn", async () => {
      const entityId = randomUUID();
      const before = await snap(files.ownF2!, entityId);
      const res = await postFoundation("linker", files.ownF2!, {
        moduleCode: "FOUNDATION",
        entityType: "Employee",
        entityId,
        linkType: "Attachment",
      });
      expect(res.status, `F-6: ${JSON.stringify(res.body)}`).toBe(400);
      expect(JSON.stringify(res.body)).toContain("FOUNDATION-FILE-ERR-LINK");
      expect((await snap(files.ownF2!, entityId)).live).toBe(before.live);
    });

    const logRowsOf = (fileId: string) =>
      count(`SELECT count(*)::int AS n FROM file_access_logs WHERE file_id = $1`, [fileId]);

    it("F-8 cặp chưa đăng ký + id tệp không có trong công ty ⇒ 400 LINK, không ghi dòng log nào", async () => {
      const ghost = randomUUID();
      const res = await postFoundation("linker", ghost, {
        moduleCode: "FOUNDATION",
        entityType: "Employee",
        entityId: randomUUID(),
        linkType: "Attachment",
      });
      expect(res.status, `F-8: ${JSON.stringify(res.body)}`).toBe(400);
      expect(JSON.stringify(res.body)).toContain("FOUNDATION-FILE-ERR-LINK");
      expect(await logRowsOf(ghost), "F-8: không dòng log nào trỏ id tệp vắng").toBe(0);
    });

    it("F-9 thực thể đích từ chối + id tệp không có trong công ty ⇒ 403, không ghi dòng log nào", async () => {
      const ghost = randomUUID();
      const res = await postFoundation("linker", ghost, {
        moduleCode: "TASK",
        entityType: "task",
        entityId: randomUUID(),
        linkType: "Attachment",
      });
      expect(res.status, `F-9: ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain("FOUNDATION-FILE-ERR-FORBIDDEN");
      expect(await logRowsOf(ghost), "F-9: không dòng log nào trỏ id tệp vắng").toBe(0);
    });

    it("F-7 cùng người gọi: gắn 2xx ⇔ GET /foundation/files/:id = 200 (bản sao riêng, mỗi tệp một thực thể)", async () => {
      const stranger = uid("stranger");
      const me = uid("viewlinker");
      const copies: Record<string, string> = {
        "người khác · 0 liên kết": await seedFile(stranger),
        "của mình · 0 liên kết": await seedFile(me),
        "liên kết không xem được": await seedHiddenLinked(stranger),
        "của mình · đã từng gắn": await seedRevoked(me),
        "liên kết TASK ngoài quyền": await seedFile(stranger),
      };
      await insertLink(copies["liên kết TASK ngoài quyền"]!, "TASK", "task", taskT2, stranger);

      const mismatches: string[] = [];
      let allowed = 0;
      for (const [name, fileId] of Object.entries(copies)) {
        const get = await w.get(tok("viewlinker"), `/foundation/files/${fileId}`);
        const post = await postFoundation("viewlinker", fileId, contractTarget(randomUUID()));
        const canView = get.status === 200;
        const linked = post.status >= 200 && post.status < 300;
        if (linked) allowed += 1;
        if (canView !== linked) mismatches.push(`${name}: GET ${get.status} · gắn ${post.status}`);
      }
      expect(mismatches, "gắn được phải trùng với xem được").toEqual([]);
      expect(allowed, "có ít nhất một ca ALLOW (không so rỗng với rỗng)").toBeGreaterThan(0);
    });

    // ─── GET /foundation/files/:id + danh sách — cùng vị từ ─────────────────

    it("G-1 chủ tệp chưa từng gắn ⇒ GET /:id 200 (vế chủ tệp)", async () => {
      const res = await w.get(tok("viewer"), `/foundation/files/${files.gOwn}`);
      expect(res.status, `G-1: ${JSON.stringify(res.body)}`).toBe(200);
    });

    it("G-1d neo: tệp người khác, cùng grant từ chối ⇒ GET /:id 403", async () => {
      const res = await w.get(tok("viewer"), `/foundation/files/${files.gOther}`);
      expect(res.status, `G-1d: ${JSON.stringify(res.body)}`).toBe(403);
    });

    it("G-1L danh sách: hàng của chủ tệp đủ tên, hàng người khác bị che", async () => {
      const res = await w.get(tok("viewer"), `/foundation/files?page=1&limit=${PAGE_LIMIT_MAX}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = rowsOf(res.body);
      const own = rows.find((r) => r.id === files.gOwn);
      const other = rows.find((r) => r.id === files.gOther);
      expect(own, "hàng G_own có mặt").toBeDefined();
      expect(other, "hàng G_other có mặt").toBeDefined();
      expect(own!.originalName, "G_own: chủ tệp thấy tên").toBe(
        `flg-${files.gOwn!.slice(0, 8)}.png`,
      );
      expect(other!.originalName, "G_other: bị che").toBeNull();
    });

    it("G-2 tệp đã từng gắn, 0 liên kết sống ⇒ GET /:id 403 kể cả với chủ tệp giữ view:foundation-file", async () => {
      const res = await w.get(tok("viewlinker"), `/foundation/files/${files.revG}`);
      expect(res.status, `G-2: ${JSON.stringify(res.body)}`).toBe(403);
    });
  },
);
