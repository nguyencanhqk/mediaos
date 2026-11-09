/**
 * S19-SEC-FILEPOINTER-1 — con trỏ tệp trên thực thể chỉ được ghi khi người ghi xem được tệp theo cùng quyết
 * định với `GET /foundation/files/:id`; đường ký avatar danh bạ chỉ ký ảnh độc quyền.
 *
 * Bất biến đo ở đây:
 *   (FP-1) `findVerifiedAvatarsTx` chỉ trả ảnh có liên kết avatar sống + primary + KHÔNG liên kết sống nào khác;
 *   (P3)   logo công ty ngoài endpoint branding chỉ nhận rỗng / http(s) / giữ giá trị hiện có;
 *   (P4)   DTO tạo/sửa hợp đồng không ghi được `file_id` (chỉ `POST /hr/contracts/:id/file`);
 *   (P5/P6) đính kèm đơn ATT: người nộp phải xem được tệp; từ chối ⇒ con trỏ/đơn không đổi.
 * Mỗi ca TỪ CHỐI có ca CHO PHÉP đứng cạnh. Tệp gieo bằng pool `direct` (không PUT storage).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { FileRepository } from "../../src/foundation/files/file.repository";
import { hasDb } from "../helpers/integration-db";
import {
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
} from "../helpers/seed";
import { bootQa1World, type Json, type Qa1World } from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 180_000;
const LOGIN_PW = ["Passw0rd", "fp19"].join("!");

type Scope = "Own" | "Company";
type PairGrant = readonly [string, string, Scope?];
const ADMIN_PAIRS: readonly PairGrant[] = [
  ["configure-company", "company"],
  ["update", "foundation-company"],
  ["update", "foundation-setting"],
  ["manage", "contract"],
  ["read", "employee"],
];
const ATT_OWN_PAIRS: readonly PairGrant[] = [
  ["create-own", "adjustment", "Own"],
  ["create-own", "remote-request", "Own"],
];

const LOGO_REF = "FOUNDATION-BRAND-ERR-LOGO-REF";
const FAVICON_REF = "FOUNDATION-BRAND-ERR-FAVICON-REF";
const FAVICON_KEY = "branding.favicon_file_id";
const FILE_FORBIDDEN = "FOUNDATION-FILE-ERR-FORBIDDEN";
const FILE_LINK = "FOUNDATION-FILE-ERR-LINK";
const FILE_INFECTED = "FOUNDATION-FILE-ERR-INFECTED";

const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;
type Res = { status: number; body: unknown };

describe.skipIf(!hasLaneDb)(
  "S19-SEC-FILEPOINTER-1 · con trỏ tệp theo cùng quyết định xem từng tệp",
  () => {
    let w: Qa1World;
    let repo: FileRepository;
    let db: DatabaseService;
    const ids = new Map<string, string>();
    const tokens = new Map<string, string>();
    let seq = 0;

    // ─── Fixture ──────────────────────────────────────────────────────────────

    async function makeUser(label: string, pairs: readonly PairGrant[]): Promise<void> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const userId = await seedUser(w.direct, w.A.companyId, `${label}@${w.A.slug}.test`, hash);
      const roleId = await seedRole(w.direct, w.A.companyId, `fp-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of pairs) {
        const permId = await seedPermissionCatalog(w.direct, action, resource, false);
        await seedRolePermission(w.direct, roleId, permId, "ALLOW", scope ?? "Company");
      }
      await seedUserRole(w.direct, userId, roleId, w.A.companyId);
      ids.set(label, userId);
      const res = await w
        .post(null, "/auth/login")
        .send({ companySlug: w.A.slug, email: `${label}@${w.A.slug}.test`, password: LOGIN_PW });
      expect(res.status, `login ${label}: ${JSON.stringify(res.body)}`).toBe(200);
      tokens.set(label, dataOf(res.body).accessToken as string);
    }
    const tok = (label: string): string => tokens.get(label)!;
    const uid = (label: string): string => ids.get(label)!;

    async function seedFile(
      ownerId: string,
      opts: { companyId?: string; scan?: string } = {},
    ): Promise<string> {
      const id = randomUUID();
      const companyId = opts.companyId ?? w.A.companyId;
      await w.direct.query(
        `INSERT INTO files (id, company_id, original_name, stored_name, mime_type, file_extension,
                            file_size_bytes, storage_provider, storage_path, upload_status, scan_status,
                            owner_user_id, uploaded_by, uploaded_at)
         VALUES ($1,$2,$3,$4,'image/png','png',2048,'MinIO',$5,'Uploaded',$7,$6,$6,now())`,
        [
          id,
          companyId,
          `fp-${id.slice(0, 8)}.png`,
          `stored-${id}`,
          `${companyId}/files/${id}`,
          ownerId,
          opts.scan ?? "Clean",
        ],
      );
      return id;
    }

    async function seedEmployee(userId: string | null): Promise<string> {
      const r = await w.direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, status, employee_code)
         VALUES ($1, $2, 'active', $3) RETURNING id`,
        [w.A.companyId, userId, `FP-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0]!.id;
    }

    async function link(
      fileId: string,
      entityId: string,
      createdBy: string,
      o: { module?: string; entity?: string; type?: string; primary?: boolean; deleted?: boolean },
    ): Promise<void> {
      await w.direct.query(
        `INSERT INTO file_links (company_id, file_id, module_code, entity_type, entity_id, link_type,
                                 created_by, is_primary, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          w.A.companyId,
          fileId,
          o.module ?? "ME",
          o.entity ?? "avatar",
          entityId,
          o.type ?? "Avatar",
          createdBy,
          o.primary ?? true,
          o.deleted ? new Date() : null,
        ],
      );
    }

    async function scalar(sql: string, params: unknown[]): Promise<string | null> {
      const r = await w.direct.query<{ v: string | null }>(sql, params);
      return r.rows[0]?.v ?? null;
    }
    const count = async (sql: string, params: unknown[] = [w.A.companyId]): Promise<number> =>
      Number(await scalar(`SELECT count(*)::text AS v FROM (${sql}) q`, params));

    const logoOf = () =>
      scalar(`SELECT logo_url AS v FROM companies WHERE id = $1`, [w.A.companyId]);
    const shortNameOf = () =>
      scalar(`SELECT short_name AS v FROM companies WHERE id = $1`, [w.A.companyId]);
    const setLogo = (v: string | null) =>
      w.direct.query(`UPDATE companies SET logo_url = $2 WHERE id = $1`, [w.A.companyId, v]);
    const auditCount = (action: string) =>
      count(`SELECT 1 FROM audit_logs WHERE company_id = $1 AND action = '${action}'`);
    const linkLogs = () =>
      count(`SELECT 1 FROM file_access_logs WHERE company_id = $1 AND action = 'Link'`);
    const taskCounter = () =>
      scalar(
        `SELECT current_value::text AS v FROM sequence_counters
         WHERE company_id = $1 AND sequence_key = 'task' AND deleted_at IS NULL`,
        [w.A.companyId],
      );

    function expectStatusCode(res: Res, status: number, code: string, what: string): void {
      expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(status);
      expect(JSON.stringify(res.body), `${what}: mã ${code}`).toContain(code);
    }
    const expectOk = (res: Res, what: string): void =>
      expect(
        res.status >= 200 && res.status < 300,
        `${what}: ${res.status} ${JSON.stringify(res.body)}`,
      ).toBe(true);

    function verify(fileIds: string[]) {
      return db.withTenant(w.A.companyId, (tx) =>
        repo.findVerifiedAvatarsTx(w.A.companyId, fileIds, tx),
      );
    }

    beforeAll(async () => {
      w = await bootQa1World("fp");
      repo = w.app.get(FileRepository);
      db = w.app.get(DatabaseService);
      await makeUser("adm", ADMIN_PAIRS);
      await makeUser("e1", ATT_OWN_PAIRS);
      await makeUser("e2", ATT_OWN_PAIRS);
      await makeUser("boss", [
        ["create-own", "adjustment"],
        ["create-own", "remote-request"],
      ]);
      await makeUser("o", []);
      await seedEmployee(uid("e1"));
      await seedEmployee(uid("e2"));
      await seedEmployee(uid("boss"));
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      await w?.close();
    });

    // ─── FP-1 · đường ký avatar danh bạ chỉ ký ảnh độc quyền ─────────────────────

    describe("FP-1 · ảnh avatar danh bạ độc quyền", () => {
      it("ảnh độc quyền primary ⇒ trả; ảnh có liên kết sống khác ⇒ không; primary=false ⇒ không", async () => {
        const U = uid("o");
        const [e1, e2, e3, e4] = [
          await seedEmployee(null),
          await seedEmployee(null),
          await seedEmployee(null),
          await seedEmployee(null),
        ];
        const solo = await seedFile(U);
        await link(solo, e1, U, {});
        const shared = await seedFile(U);
        await link(shared, e2, U, {});
        await link(shared, randomUUID(), U, { module: "TASK", entity: "task", type: "Attachment" });
        const nonPrimary = await seedFile(U);
        await link(nonPrimary, e3, U, { primary: false });
        const deletedOther = await seedFile(U);
        await link(deletedOther, e4, U, {});
        await link(deletedOther, randomUUID(), U, {
          module: "TASK",
          entity: "task",
          type: "Attachment",
          deleted: true,
        });

        const got = (await verify([solo, shared, nonPrimary, deletedOther])).map((r) => r.fileId);
        expect(got.sort()).toEqual([solo, deletedOther].sort());
      });

      it("HR đặt hộ (chủ tệp = người tạo liên kết = HR) độc quyền ⇒ trả", async () => {
        const hr = uid("adm");
        const emp = await seedEmployee(null);
        const f = await seedFile(hr);
        await link(f, emp, hr, {});
        expect((await verify([f])).map((r) => r.employeeId)).toEqual([emp]);
      });

      it("hai NV cùng trỏ một tệp ⇒ không trả cho cả hai; tệp độc quyền cùng lượt vẫn trả", async () => {
        const U = uid("o");
        const [a, b, c] = [
          await seedEmployee(null),
          await seedEmployee(null),
          await seedEmployee(null),
        ];
        const both = await seedFile(U);
        await link(both, a, U, {});
        await link(both, b, U, {});
        const solo = await seedFile(U);
        await link(solo, c, U, {});
        const got = await verify([both, solo]);
        expect(got.map((r) => r.fileId)).toEqual([solo]);
      });

      it("HTTP GET /hr/employees: ảnh dùng chung ⇒ avatarUrl null; ảnh độc quyền ⇒ có URL", async () => {
        const U = uid("o");
        const solo = await seedFile(U);
        const shared = await seedFile(U);
        const eSolo = await seedEmployee(null);
        const eShared = await seedEmployee(null);
        await link(solo, eSolo, U, {});
        await link(shared, eShared, U, {});
        await link(shared, randomUUID(), U, { module: "TASK", entity: "task", type: "Attachment" });
        await w.direct.query(`UPDATE employee_profiles SET avatar_url = $2 WHERE id = $1`, [
          eSolo,
          solo,
        ]);
        await w.direct.query(`UPDATE employee_profiles SET avatar_url = $2 WHERE id = $1`, [
          eShared,
          shared,
        ]);

        const res = await w.get(tok("adm"), "/hr/employees?pageSize=100");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const items = JSON.stringify(res.body);
        const avatarOf = (id: string): unknown => {
          const walk = (n: unknown): unknown => {
            if (Array.isArray(n)) return n.map(walk).find((x) => x !== undefined);
            if (n && typeof n === "object") {
              const o = n as Record<string, unknown>;
              if (o.id === id && "avatarUrl" in o) return { v: o.avatarUrl };
              return Object.values(o)
                .map(walk)
                .find((x) => x !== undefined);
            }
            return undefined;
          };
          return walk(res.body);
        };
        expect(items.length).toBeGreaterThan(0);
        expect(avatarOf(eShared), "ảnh dùng chung").toEqual({ v: null });
        const own = avatarOf(eSolo) as { v: string | null } | undefined;
        expect(own?.v, "ảnh độc quyền").toEqual(expect.stringContaining("http"));
      });
    });

    // ─── P3 · logo công ty ngoài endpoint branding ───────────────────────────────

    const ROUTES: readonly { name: string; patch: (body: Json) => Promise<Res>; audit: string }[] =
      [
        {
          name: "PATCH /settings/company",
          patch: (b) => w.patch(tok("adm"), "/settings/company").send(b),
          audit: "CompanySettingsUpdated",
        },
        {
          name: "PATCH /foundation/company/current",
          patch: (b) => w.patch(tok("adm"), "/foundation/company/current").send(b),
          audit: "COMPANY_UPDATED",
        },
      ];

    describe.each(ROUTES)("P3 · logo công ty qua $name", ({ patch, audit }) => {
      it("mã tệp khác giá trị hiện có ⇒ 400, không trường nào đổi, 0 audit mới", async () => {
        await setLogo("https://seed.test/logo.png");
        const f = await seedFile(uid("adm"));
        const before = await auditCount(audit);
        const res = await patch({ logoUrl: f, shortName: `fp-${++seq}` });
        expectStatusCode(res, 400, LOGO_REF, "mã tệp");
        expect(await logoOf()).toBe("https://seed.test/logo.png");
        expect(await shortNameOf()).not.toBe(`fp-${seq}`);
        expect(await auditCount(audit)).toBe(before);
      });

      it("null / http(s) / không gửi ⇒ 200", async () => {
        expectOk(await patch({ logoUrl: null }), "null");
        expect(await logoOf()).toBeNull();
        expectOk(await patch({ logoUrl: "https://x.test/l.png" }), "http(s)");
        expect(await logoOf()).toBe("https://x.test/l.png");
        expectOk(await patch({ shortName: `fp-keep-${++seq}` }), "không gửi logo");
        expect(await logoOf()).toBe("https://x.test/l.png");
      });

      it("mã trùng giá trị hiện có (kể cả chữ HOA) ⇒ 200, giữ chuỗi cũ, trường khác đổi", async () => {
        const same = randomUUID();
        await setLogo(same);
        const name = `fp-same-${++seq}`;
        expectOk(await patch({ logoUrl: same.toUpperCase(), shortName: name }), "trùng");
        expect(await logoOf()).toBe(same);
        expect(await shortNameOf()).toBe(name);
      });
    });

    it("P3 · endpoint branding vẫn đặt được logo bằng mã tệp (đường duy nhất cho mã tệp)", async () => {
      await setLogo(null);
      const f = await seedFile(uid("adm"));
      const res = await w.put(tok("adm"), "/foundation/company/branding/logo").send({ fileId: f });
      expectOk(res, "PUT branding/logo");
      expect(await logoOf()).toBe(f);
    });

    // ─── P3f · favicon ngoài endpoint branding ───────────────────────────────────

    describe("P3f · favicon qua PATCH /foundation/company-settings/:key", () => {
      const faviconOf = () =>
        scalar(
          `SELECT setting_value #>> '{}' AS v FROM company_settings
           WHERE company_id = $1 AND setting_key = $2 AND deleted_at IS NULL`,
          [w.A.companyId, FAVICON_KEY],
        );
      const setFavicon = (v: string) =>
        w.direct.query(
          `INSERT INTO company_settings (company_id, setting_key, setting_value, value_type, category)
           VALUES ($1,$2,to_jsonb($3::text),'String','Branding')
           ON CONFLICT (company_id, setting_key) WHERE deleted_at IS NULL AND status = 'Active'
           DO UPDATE SET setting_value = EXCLUDED.setting_value`,
          [w.A.companyId, FAVICON_KEY, v],
        );
      const patchFav = (v: unknown) =>
        w
          .patch(tok("adm"), `/foundation/company-settings/${FAVICON_KEY}`)
          .send({ settingValue: v, valueType: "String" });

      it("mã tệp khác giá trị hiện có ⇒ 400, giá trị không đổi, 0 audit mới", async () => {
        await setFavicon("https://seed.test/f.ico");
        const f = await seedFile(uid("adm"));
        const before = await auditCount("COMPANY_SETTING_UPDATED");
        expectStatusCode(await patchFav(f), 400, FAVICON_REF, "mã tệp");
        expect(await faviconOf()).toBe("https://seed.test/f.ico");
        expect(await auditCount("COMPANY_SETTING_UPDATED")).toBe(before);
      });

      it("rỗng / http(s) / trùng giá trị hiện có ⇒ 200", async () => {
        expectOk(await patchFav(""), "rỗng");
        expect(await faviconOf()).toBe("");
        expectOk(await patchFav("https://x.test/f.ico"), "http(s)");
        expect(await faviconOf()).toBe("https://x.test/f.ico");
        const same = randomUUID();
        await setFavicon(same);
        expectOk(await patchFav(same.toUpperCase()), "trùng");
        expect(await faviconOf()).toBe(same);
      });

      it("endpoint branding vẫn đặt được favicon bằng mã tệp", async () => {
        const f = await seedFile(uid("adm"));
        const res = await w.put(tok("adm"), "/foundation/company/branding/favicon").send({ fileId: f });
        expectOk(res, "PUT branding/favicon");
        expect(await faviconOf()).toBe(f);
      });
    });

    // ─── P4 · hợp đồng ───────────────────────────────────────────────────────────

    describe("P4 · tệp hợp đồng chỉ gắn qua POST /hr/contracts/:id/file", () => {
      let employeeId = "";
      let typeId = "";
      let contractId = "";
      const fileOf = (id: string) =>
        scalar(`SELECT file_id::text AS v FROM employee_contracts WHERE id = $1`, [id]);
      const updatedAtOf = (id: string) =>
        scalar(`SELECT updated_at::text AS v FROM employee_contracts WHERE id = $1`, [id]);
      const contractAudits = (id: string) =>
        count(
          `SELECT 1 FROM audit_logs WHERE company_id = $1 AND object_id = '${id}' AND action = 'update'`,
        );

      beforeAll(async () => {
        employeeId = await seedEmployee(null);
        const t = await w.direct.query<{ id: string }>(
          `INSERT INTO contract_types (company_id, name, requires_end_date) VALUES ($1,$2,false) RETURNING id`,
          [w.A.companyId, `fp-ct-${randomUUID().slice(0, 6)}`],
        );
        typeId = t.rows[0]!.id;
      });

      it("POST kèm fileId (tệp của người khác và tệp của chính mình) ⇒ 201, file_id NULL", async () => {
        for (const owner of [uid("o"), uid("adm")]) {
          const f = await seedFile(owner);
          const res = await w.post(tok("adm"), "/hr/contracts").send({
            employeeId,
            contractTypeId: typeId,
            startDate: "2027-01-01",
            fileId: f,
          });
          expect(res.status, JSON.stringify(res.body)).toBe(201);
          const id = dataOf(res.body).id as string;
          contractId = id;
          expect(await fileOf(id)).toBeNull();
        }
      });

      it("PATCH chỉ có fileId ⇒ 200, file_id/updated_at không đổi, 0 audit update mới", async () => {
        const f = await seedFile(uid("o"));
        const beforeAt = await updatedAtOf(contractId);
        const beforeAudit = await contractAudits(contractId);
        for (const body of [{ fileId: f }, { fileId: null }]) {
          const res = await w.patch(tok("adm"), `/hr/contracts/${contractId}`).send(body);
          expect(res.status, JSON.stringify(res.body)).toBe(200);
        }
        expect(await fileOf(contractId)).toBeNull();
        expect(await updatedAtOf(contractId)).toBe(beforeAt);
        expect(await contractAudits(contractId)).toBe(beforeAudit);
      });

      it("PATCH {fileId, note} ⇒ note đổi, file_id không đổi", async () => {
        const f = await seedFile(uid("o"));
        const note = `fp-note-${++seq}`;
        const res = await w
          .patch(tok("adm"), `/hr/contracts/${contractId}`)
          .send({ fileId: f, note });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(
          await scalar(`SELECT note AS v FROM employee_contracts WHERE id = $1`, [contractId]),
        ).toBe(note);
        expect(await fileOf(contractId)).toBeNull();
      });

      it("POST /hr/contracts/:id/file với tệp xem được ⇒ file_id = tệp", async () => {
        const f = await seedFile(uid("adm"));
        const res = await w
          .post(tok("adm"), `/hr/contracts/${contractId}/file`)
          .send({ fileId: f });
        expectOk(res, "gắn tệp hợp đồng");
        expect(await fileOf(contractId)).toBe(f);
      });
    });

    // ─── P5/P6 · đính kèm đơn ATT ────────────────────────────────────────────────

    const ATT_ROUTES = [
      {
        name: "điều chỉnh công",
        url: "/attendance/adjustment-requests",
        table: "attendance_adjustment_requests",
        body: (day: string, extra: Json): Json => ({
          workDate: day,
          requestType: "UPDATE_CHECK_IN",
          reason: "Điều chỉnh giờ vào (fp)",
          requestedCheckInAt: `${day}T02:00:00Z`,
          ...extra,
        }),
        burnsCounter: true,
      },
      {
        name: "làm từ xa",
        url: "/attendance/remote-work-requests",
        table: "remote_work_requests",
        body: (day: string, extra: Json): Json => ({
          requestType: "Remote",
          startDate: day,
          endDate: day,
          reason: "Làm việc từ xa (fp)",
          ...extra,
        }),
        burnsCounter: false,
      },
    ] as const;

    describe.each(ATT_ROUTES)("P5/P6 · đính kèm đơn $name", (r) => {
      let dayNo = 0;
      const day = (): string =>
        `2028-0${r.burnsCounter ? 3 : 4}-${String(10 + ++dayNo).padStart(2, "0")}`;
      const rows = () => count(`SELECT 1 FROM ${r.table} WHERE company_id = $1`);
      const send = (label: string, extra: Json) =>
        w.post(tok(label), r.url).send(r.body(day(), extra));

      it("tệp người khác sở hữu, 0 liên kết ⇒ 403, 0 đơn, không đốt mã", async () => {
        const f = await seedFile(uid("o"));
        const [n, c] = [await rows(), await taskCounter()];
        const res = await send("e1", { attachmentFileId: f });
        expectStatusCode(res, 403, FILE_FORBIDDEN, "tệp người khác");
        expect(await rows()).toBe(n);
        expect(await taskCounter()).toBe(c);
      });

      it("tệp không tồn tại / thuộc tenant khác ⇒ 400 LINK, 0 đơn", async () => {
        const otherUser = await seedUser(
          w.direct,
          w.B.companyId,
          `fpb-${randomUUID().slice(0, 6)}@${w.B.slug}.test`,
          "x",
        );
        const foreign = await seedFile(otherUser, { companyId: w.B.companyId });
        const n = await rows();
        for (const id of [randomUUID(), foreign]) {
          expectStatusCode(
            await send("e1", { attachmentFileId: id }),
            400,
            FILE_LINK,
            "không thấy tệp",
          );
        }
        expect(await rows()).toBe(n);
      });

      it("tệp Infected của chính mình ⇒ 400 INFECTED, 0 đơn", async () => {
        const f = await seedFile(uid("e1"), { scan: "Infected" });
        const n = await rows();
        expectStatusCode(await send("e1", { attachmentFileId: f }), 400, FILE_INFECTED, "Infected");
        expect(await rows()).toBe(n);
      });

      it("tệp chính mình upload ⇒ 201, con trỏ = tệp; không đính kèm ⇒ 201", async () => {
        const f = await seedFile(uid("e1"));
        const res = await send("e1", { attachmentFileId: f });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(
          await scalar(`SELECT attachment_file_id::text AS v FROM ${r.table} WHERE id = $1`, [
            dataOf(res.body).id as string,
          ]),
        ).toBe(f);
        const plain = await send("e2", {});
        expect(plain.status, JSON.stringify(plain.body)).toBe(201);
      });

      it("thứ tự: nộp hộ NV khác không đủ quyền kèm tệp của người khác ⇒ 403 của ATT, chưa chạm tệp", async () => {
        const target = await scalar(
          `SELECT id::text AS v FROM employee_profiles WHERE user_id = $1`,
          [uid("e2")],
        );
        const f = await seedFile(uid("o"));
        const [n, logs] = [await rows(), await linkLogs()];
        const res = await send("e1", { attachmentFileId: f, targetEmployeeId: target });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain("FOUNDATION-FILE-ERR");
        expect(await linkLogs()).toBe(logs);
        expect(await rows()).toBe(n);
      });
    });
  },
);
