# S16-SOCIAL-PERMMEMO-1 — MEMO ẢNH CHỤP GRANT THEO REQUEST (`getCompanyRoleGrantsWithScope`)

> Zone **red** (crown-jewel: tầng permission, bán kính = MỌI module gọi `resolveStrongestScope(s)`) · **0 migration** · 0 cặp quyền mới · 0 route mới · **CẦN ADR** ⇒ `docs/DECISIONS/DECISIONS-15_Request_Scoped_Grant_Snapshot_Memo.md`.
> Nguồn: `harness/backlog.mjs` WO `S16-SOCIAL-PERMMEMO-1` (~`:17212`); tách từ `docs/plans/S16-SOCIAL-ATTDEBT-1.md` D-1 lối (c).
> Lập 25/09/2026 (planner) theo CLAUDE.md §6 (crown ⇒ micro-plan → `plan-reviewer` → mới code).
> **Owner ĐÃ KÝ 25/09/2026 (KHÔNG mở lại):** D1 ảnh chụp + trần tuổi · D2 tầng `CachedPermissionRepository` + ALS mở ở middleware, ngoài request = passthrough · D3 KHÔNG memo `getCompanyRoleGrants`.

---

## §0 — PHÉP ĐO HIỆN TRẠNG (đọc mã 25/09/2026, có dòng dẫn chứng)

| # | Câu hỏi | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| M1 | `getCompanyRoleGrantsWithScope` ở tầng cache làm gì? | **Passthrough CỐ Ý**, không Valkey, không memo | `permission/permission.cache.ts:91-100` |
| M2 | Ai gọi nó? | **Chỉ** `PermissionService`: `getCapabilityScopes` `:743` · `resolveStrongestScope` `:798` · `resolveStrongestScopes` `:843`. Không service nào gọi thẳng repo | grep `src/**` |
| M3 | Mỗi lời gọi tốn gì? | 1 `db.withTenant` = 1 transaction THẬT | `permission.repository.ts:66-102` |
| M4 | Có bao nhiêu instance `CachedPermissionRepository` ở runtime? | **MỘT**: factory `CACHED_REPO` | `permission.module.ts:122-127`. Ngoài ra ~18 int-spec dựng `new PermissionService(new PermissionRepository(db))` (KHÔNG qua cache) ⇒ các spec đó không bao giờ thấy memo, đúng như thiết kế |
| M5 | 🔴 «Kho KHÔNG có ALS» (backlog done_when #3, gốc ATTGATE-1 M8) | **SAI / LỖI THỜI.** ALS có từ S10-FND-JSONLOG-1: `common/logger/request-context.ts` (store `{requestId}`) mở trong `requestIdMiddleware` (`common/middleware/request-id.middleware.ts`), đăng ký `main.ts:27` bằng `app.use` | đọc mã |
| M6 | 🔴 Int-spec có đăng ký middleware đó không? | **KHÔNG.** 311 chỗ `createNestApplication`; `requestIdMiddleware` chỉ có ở `main.ts`. `social-attdebt-1-cost-alert.int-spec.ts:186-190` chỉ gắn interceptor + filter | grep `test/**` `src/**` |
| M7 | ALS có sống qua body-parser (PATCH/POST JSON)? | raw-body@3.0.2 bind callback bằng `AsyncResource` (`raw-body/index.js:317-326`); express@5.2.1, body-parser@2.2.2 ⇒ **nhiều khả năng CÓ**. Multer/busboy (upload) **chưa xác minh** | `node_modules/.pnpm`. ⇒ H7 ở §4 đo thật |
| M8 | `invalidateUser` được gọi từ đâu? | **Chỉ** từ handler outbox `permission.changed` | `permission.module.ts:85`. Handler chạy trong `OutboxWorker.processBatch` do scheduler gọi định kỳ, **NGOÀI mọi request** ⇒ không với tới store ALS của request nào |
| M9 | Độ trễ outbox | `OUTBOX_POLL_MS` mặc định **5000ms** (min 250) | `config/env.schema.ts:171` ⇒ `invalidateUser` đến sau commit 0–5s+; cửa sổ `can()` (Valkey) HÔM NAY đã là ≤~5s |
| M10 | Đường nào GHI grant? | `permission-admin.repository.ts:106,135` (user_roles) · `role-admin.repository.ts:124,262,287` (role_permissions/user_roles) · `super-admin-bootstrap.repository.ts:146-169` (lúc boot) | grep insert/update/delete |
| M11 | Có request nào GHI grant rồi ĐỌC scope trong CÙNG request? | **KHÔNG tìm thấy.** `revokeRole` đọc `hasCompanyWideDirectory` TRƯỚC write-tx (`permission-admin.service.ts:230-246`, KI-074); `assignRole`/role-admin gọi `assertCan` (đường `can()`) trước tx; `listMembers` chỉ đọc | đọc mã. ⇒ D-7 |
| M12 | Ghi `role_permissions` có phát `permission.changed`? | **KHÔNG**, đây là nợ có sẵn (`role-admin.service.ts:81`) ⇒ `can()` lệch tới 300s. Memo không làm tệ thêm (bị chặn bởi trần 2s) | ghi vào ADR §6 |
| M13 | Người gọi có sửa mảng grant? | `decideStrongestScope` chỉ `filter`/`some` (`permission.decide.ts:~231-261`); `getCapabilityScopes` chỉ `filter`. Nhưng `expiresAt` là `Date`, thứ `Object.freeze` KHÔNG đóng băng được | ⇒ D-4 chọn clone |
| M14 | Topology PROD | **MỘT tiến trình**: service NSSM «MediaOS-API» chạy `node apps\api\dist\main.js`; scheduler/outbox chạy cùng tiến trình (`scheduler.module.ts`) | `mediaos.ps1:30,417` |
| M15 | p95 PROD | ≤30ms mọi endpoint smoke | `docs/DEVOPS/DEVOPS-15…:41` |
| M16 | Khuôn đo sẵn có | spy CALL-THROUGH `PermissionRepository.getCompanyRoleGrantsWithScope` + neo chống-xanh-rỗng | `test/integration/social-attdebt-1-cost-alert.int-spec.ts:217-290`. Số thật §9.1 ATTDEBT: PATCH có đính kèm = **3** lần nạp |
| M17 | Route non-SOCIAL đọc ≥2 lần | `GET /auth/login-logs`: `view:audit-log` (`auth-logs-viewer.service.ts:106`) + `view:user` (`resolveDirectoryScope`) = **2** | đọc mã |
| M18 | Tiền lệ single-flight/ảnh chụp | ADR-12 §5.3 D6 (promise chia sẻ không reject) · D7 (state PER-INSTANCE) | ⇒ ADR-15 giải thích vì sao lệch có chủ đích |

### 0.1 — Không xác minh được trong phiên plan

- Không chạy DB/test. Số «trước» của §4.3 là THIẾT KẾ phép đo; Phase A phải chạy RED để ghi số thật.
- Không đọc được `.env` PROD ⇒ người thi công xác minh PROD KHÔNG override `OUTBOX_POLL_MS` trước khi chép lập luận M9 vào ADR (nếu có override thì ghi lại giá trị thật).

---

## §1 — QUYẾT ĐỊNH (trong khung D1–D3 owner đã ký)

### D-1 — ALS RIÊNG cho memo, KHÔNG mở rộng store của logger

Store logger có kiểu `{requestId}`, thuộc tầng quan sát. Nhét grant vào đó sẽ buộc `common/logger` biết `CompanyRoleGrantWithScope` và trộn hai vòng đời (kill-switch memo không được tắt log). ⇒ ALS mới ở **`apps/api/src/permission/grant-snapshot-memo.ts`**, mở bằng middleware chức năng MỚI **`apps/api/src/common/middleware/grant-memo.middleware.ts`** (`common` đã import `permission`, xem `common/idempotency/*`, nên không mở cạnh phụ thuộc mới). Đăng ký ở `main.ts` **ngay sau** `requestIdMiddleware`.

### D-2 — Khoá, hình dạng store, tách theo instance

- Store ALS = `Map<GrantSnapshotMemo, Map<string, Entry>>`, **tách theo instance memo**. Hai repo khác nhau trong cùng một ngữ cảnh (spec) không được đọc chéo nhau.
- Khoá = `` `${companyId}\u0000${userId}` `` (UUID không chứa `\u0000`). **companyId BẮT BUỘC trong khoá**, đây là bất biến #1.
- `Entry = { promise, startedAt, epoch }`; `startedAt` và `epoch` chụp **TRƯỚC** khi gọi `load()`.
- Trần số khoá **`GRANT_MEMO_MAX_ENTRIES = 64`** mỗi (request × instance). Trần này chặn rò bộ nhớ khi một tài nguyên async sống lâu kế thừa store (R2) và khi fan-out nhiều người nhận. Ngữ nghĩa (plan-review F7): **trước khi kiểm trần, tỉa mọi entry hết tuổi hoặc lệch epoch**; tải lại một khoá đã có ⇒ ghi đè tại chỗ (không tính thêm). Sau tỉa vẫn đủ 64 ⇒ passthrough, không chèn, và `logger.debug` MỘT lần cho mỗi store (cờ trên store) — không bao giờ nới quyền, tệ nhất chỉ mất phần tiết kiệm.
- ⚠️ Một request có thể resolve scope cho NHIỀU user cùng công ty (vd `tasks/task-comments.service.ts:323` hỏi scope từng người được mention — KHÔNG phải actor). Vì vậy `userId` trong khoá cũng load-bearing như `companyId` (U13/X13).

### D-3 — Thu hồi: EPOCH toàn tiến trình + trần tuổi 2000ms (D1 owner)

- `let epoch = 0` cấp module; `bumpGrantSnapshotEpoch()` tăng 1. Entry hợp lệ ⇔ `entry.epoch === epoch && now() - entry.startedAt < GRANT_MEMO_MAX_AGE_MS`.
- `CachedPermissionRepository.invalidateUser` gọi `bumpGrantSnapshotEpoch()` ở **DÒNG ĐẦU**, trước `await valkey.del` (DEL có thể ném, xem `permission.cache.ts:175-182`).
- **Vì sao không «xoá store hiện tại»:** handler outbox chạy ngoài request (M8). `getStore()` ở đó là `undefined`, nên cách xoá này không chạm tới request nào. Epoch toàn cục là cơ chế duy nhất với tới MỌI request đang bay trong tiến trình.
- **Vì sao epoch toàn cục, không theo (company,user):** thu hồi hiếm. Bump toàn cục chỉ gây thêm ≤1 lượt đọc cho mỗi request đang bay, và không có map lớn dần. Sai hướng nào cũng là thừa-vô-hiệu, không bao giờ thiếu.
- **2000ms:** (i) nhỏ hơn cửa sổ outbox 5000ms (M9), nên memo không bao giờ thành cửa sổ dài nhất hệ thống; (ii) ≈60× p95 PROD (M15), nên request thường đọc đúng 1 lần; (iii) export/PDF lô chạy dài sẽ đọc lại mỗi 2s. Nhỏ hơn (250ms) thì mất phần tiết kiệm ở request chậm; lớn hơn (5s) thì chỉ thêm phơi nhiễm, không thêm lợi.
- **Đồng hồ = `performance.now()` (đơn điệu), TIÊM được** qua constructor. Đồng hồ tường lùi giờ có thể kéo dài memo. `vi.useFakeTimers` mặc định không giả `performance`, nên test tiêm `now` thay vì dựa fake timers.
- Nói thẳng ở ADR: vì outbox trễ 0–5s, trong THỰC TẾ trần tuổi là biên chính; `invalidateUser` là lớp phụ, có ích khi xử lý nhanh.

### D-4 — Single-flight, KHÔNG giữ promise đã reject, clone mỗi lần trả

- Lưu PROMISE để các lời gọi đồng thời trong một request chung một lượt đọc (vd `Promise.all` ở `resolveViewerContext`).
- `entry.promise.catch(() => { if (mine.get(key) === entry) mine.delete(key); })` đăng ký **ngay khi tạo**, nên chạy trước catch của caller. Lời gọi SAU lỗi đọc lại DB; các caller đang chờ cùng promise nhận chung lỗi, và `resolveStrongestScope` fail-closed `null` như hôm nay.
- **Lệch ADR-12 D6 có chủ đích:** promise chia sẻ ĐƯỢC reject, vì mọi entry luôn có đúng caller tạo ra nó `await` (không có unhandled rejection), còn `try/catch` fail-closed + log ở `permission.service.ts` là điểm xử lý lỗi hiện có. Đổi sang sentinel sẽ đổi ngữ nghĩa lỗi của 3 hàm.
- Trả `grants.map(g => ({ ...g, expiresAt: g.expiresAt === null ? null : new Date(g.expiresAt.getTime()) }))` cho **MỌI** caller, kể cả caller đầu tiên. Mảng lưu trữ không bao giờ lọt ra ngoài. Chi phí O(n) trên vài chục hàng, bỏ qua được. `decideStrongestScope` vẫn kiểm `expiresAt` với `new Date()` MỖI lần, nên grant hết hạn theo giờ trong cửa sổ memo vẫn bị loại.

### D-5 — Ngoài request = passthrough (D2 owner)

`als.getStore() === undefined` ⇒ `return load()`, y hệt hôm nay. Bao gồm job, outbox, WS gateway (engine.io/Socket.IO không đi qua Express middleware), bootstrap, và mọi int-spec không đăng ký middleware (M6).

### D-6 — Kill-switch `PERMISSION_GRANT_MEMO_ENABLED` (mặc định `"true"`)

- `z.enum(["true","false"]).default("true")` (khuôn `WORKERS_SCHEDULER_ENABLED`, `env.schema.ts:168`); khai `.env.example`.
- `"false"` ⇒ `main.ts` KHÔNG `app.use(grantMemoMiddleware)`, nên passthrough toàn phần. Đây là đúng hành vi hôm nay và được ca U7/H6 phủ.
- Hướng an toàn: tắt = nhiều DB read hơn, không bao giờ nới quyền. Vì vậy KHÔNG cần refine chặn ở production (khác `PERMISSION_GUARD_ENABLED`, `env.schema.ts:428`, là fail-open).
- Lý do có switch: bán kính toàn hệ, và rollback bằng đổi env + restart NSSM nhanh hơn revert + build.

### D-7 — Đường ghi-rồi-đọc cùng request: CHẤP NHẬN, ghi luật, KHÔNG sửa service admin

M11: không có đường nào như vậy hôm nay. Không thêm bump ở 6 điểm ghi (crown, tăng diff mà không đóng lỗ nào đang tồn tại). ADR §6.3 ghi LUẬT: code mới ghi grant rồi đọc scope trong cùng request **PHẢI** gọi `bumpGrantSnapshotEpoch()` **SAU commit**. Bump trước commit là vô hiệu: lượt đọc lại sẽ thấy dữ liệu chưa commit-cũ và memo nó dưới epoch mới.

### D-8 — Hình dạng code (tải trọng, đúng tên)

```ts
// permission/grant-snapshot-memo.ts
export const GRANT_MEMO_MAX_AGE_MS = 2_000;
export const GRANT_MEMO_MAX_ENTRIES = 64;
export function runWithGrantMemo<T>(fn: () => T): T;          // als.run(new Map(), fn)
export function bumpGrantSnapshotEpoch(): void;               // epoch += 1
export class GrantSnapshotMemo {
  constructor(opts?: { now?: () => number; maxAgeMs?: number; maxEntries?: number });
  read(companyId: string, userId: string,
       load: () => Promise<CompanyRoleGrantWithScope[]>): Promise<CompanyRoleGrantWithScope[]>;
}
// permission.cache.ts — constructor(inner, valkey, memo = new GrantSnapshotMemo())  (tham số 3 OPTIONAL:
//   permission.g3-4.spec.ts:261 + permission.cache.spec.ts dựng 2 đối số)
```

---

## §2 — FILE ĐỤNG

| File | Loại | Việc |
| --- | --- | --- |
| `apps/api/src/permission/grant-snapshot-memo.ts` | MỚI | D-2…D-5, D-8 |
| `apps/api/src/permission/grant-snapshot-memo.spec.ts` | MỚI | ca U1–U12 |
| `apps/api/src/permission/permission.cache.ts` | SỬA | `getCompanyRoleGrantsWithScope` → `memo.read`; `invalidateUser` bump dòng đầu; viết lại docblock `:91-94` + docblock lớp |
| `apps/api/src/permission/permission.cache.spec.ts` | SỬA | ca C1–C4 |
| `apps/api/src/common/middleware/grant-memo.middleware.ts` (+ `.spec.ts`) | MỚI | `grantMemoMiddleware(req,res,next){ runWithGrantMemo(next) }` |
| `apps/api/src/main.ts` ⚠️ngoài paths | SỬA | đăng ký có điều kiện sau `requestIdMiddleware` |
| `apps/api/src/config/env.schema.ts` · `.env.example` ⚠️ngoài paths | SỬA | D-6 |
| `apps/api/test/integration/permission-permmemo-1.int-spec.ts` | MỚI | ca H1–H7 |
| `apps/api/test/foundation/permmemo-wiring-structure.unit-spec.ts` | MỚI | S1: `main.ts` gọi `app.use(grantMemoMiddleware)` sau `requestIdMiddleware`, dưới cờ env |
| `apps/api/package.json` ⚠️ngoài paths | SỬA | `test:cov:sensitive` (`:12`) += int-spec mới + `src/common/middleware/grant-memo.middleware.spec.ts` + `test/foundation/permmemo-wiring-structure.unit-spec.ts`, và `--coverage.include` 3 file (`grant-snapshot-memo.ts`, `permission.cache.ts`, `grant-memo.middleware.ts`); thiếu thì cổng coverage mù với chính WO (bài học ATTDEBT M18). Script KHÔNG có cờ ngưỡng ⇒ «≥80%» đọc tay, ghi số thật từng file vào §9 |
| Comment-only (§5) | SỬA | 5 file ⚠️ngoài paths + 3 file trong paths |
| `docs/DECISIONS/DECISIONS-15_…md` · `docs/README.md` ⚠️ngoài paths · `harness/backlog.mjs` | MỚI/SỬA | ADR + chỉ mục + backlog |

**S-1 (cần owner ký — nới `paths`):** thêm `apps/api/src/main.ts`, `apps/api/src/config/env.schema.ts`, `.env.example`, `apps/api/package.json`, `docs/README.md`, và CHỈ-COMMENT: `apps/api/src/auth/auth-logs-viewer.service.ts`, `apps/api/src/auth/auth-logs-viewer.service.spec.ts`, `apps/api/src/dashboard/dashboard-widget-registry.service.ts`, `apps/api/src/foundation/audit/audit.service.ts`, `apps/api/src/recruit/recruit-access.service.ts`, `apps/api/src/social/social-access.service.ts`.

---

## §3 — THỨ TỰ THI CÔNG (RED trước)

**Phase A — RED thuần hành vi (0 dòng mã sản phẩm).** Viết U1–U12, C1–C4, H1–H7, S1. Chạy trên lane `bash scripts/lane-db-setup.sh permmemo --reset`. Ghi vào §9: số đếm «trước» thật của H1–H3 (kỳ vọng PATCH đính kèm = 3, login-logs = 2) và danh sách ca đỏ. Đỏ phải vì **thông điệp kỳ vọng**, không vì biên dịch: tạo stub `grant-snapshot-memo.ts` export đúng chữ ký, thân passthrough, để TS xanh.
**Phase B — memo + nối cache.** `grant-snapshot-memo.ts`, sửa `permission.cache.ts` ⇒ U*, C* xanh.
**Phase C — middleware + main.ts + env.** ⇒ S1, H* xanh.
**Phase D — mutant (§4.4)**, từng cái một, ghi thông điệp đỏ THẬT vào §9.
**Phase E — comment (§5) + ADR + README + backlog (§8)**; `pnpm -C apps/api typecheck` · `lint` · `test:cov:sensitive` · `test:cov:social` (hồi quy, không sửa) · int-spec ATTDEBT giữ nguyên xanh.

---

## §4 — MA TRẬN TEST

### 4.1 — Unit `grant-snapshot-memo.spec.ts` (inner giả đếm lượt, `now` tiêm)

| # | Ca | Khẳng định chính |
| --- | --- | --- |
| U1 | 3 lượt đọc (c,u) trong 1 `runWithGrantMemo` | inner = **1** |
| U2 🔴(a) deny-path | đọc ⇒ [ALLOW]; inner đổi sang []; `bumpGrantSnapshotEpoch()` | lượt sau thấy [] ⇒ `decideStrongestScope` = `null` |
| U3 🔴(a′) invalidate từ NGỮ CẢNH KHÁC | bump gọi bên trong `als.exit`/ngữ cảnh rời (mô phỏng outbox) | memo của request vẫn bị vô hiệu |
| U4 🔴(b) trần tuổi | `now` += 1999 ⇒ hit; += 2000 ⇒ inner +1 | biên `<` chính xác |
| U5 🔴(c) hai actor song song | 2 `runWithGrantMemo` chạy `Promise.all`, inner deferred resolve NGƯỢC thứ tự | mỗi ngữ cảnh nhận đúng grant của mình; inner = 2 |
| U6 (c′) cùng user, hai ngữ cảnh | | inner = **2** (memo KHÔNG xuyên request) |
| U7 🔴(d) ngoài request | N lời gọi không ALS | inner = N |
| U8 🔴(e) reject | lượt 1 inner reject ⇒ lượt 2 inner resolve | lượt 2 thành công; inner = 2; 2 caller đồng thời trên promise lỗi ⇒ inner = 1, cả hai reject |
| U9 🔴(f) chéo công ty | (c1,u) rồi (c2,u) | inner = 2, `companyId` đúng từng lượt, kết quả khác nhau |
| U10 | caller `push`/đổi `effect`/`expiresAt.setTime(0)` trên kết quả | lượt sau nhận bản gốc |
| U11 | bump TRONG KHI promise đang bay | lượt tiếp theo inner +1 (epoch chụp lúc BẮT ĐẦU) |
| U12 | khoá thứ 65 (sau tỉa) · 64 khoá hết tuổi rồi khoá mới | khoá 65 passthrough, không chèn, debug 1 lần; khi 64 khoá hết tuổi ⇒ tỉa rồi chèn được; hai instance memo trong một ngữ cảnh không đọc chéo |
| U13 🔴(f′) cùng công ty, KHÁC user, CÙNG request (plan-review F1) | trong MỘT `runWithGrantMemo`: (c,u1) ⇒ [ALLOW]; (c,u2) ⇒ [] | inner = 2; kết quả khác nhau theo user |

> U2/U3 gọi `bumpGrantSnapshotEpoch()` TRỰC TIẾP (đo cơ chế epoch). Đường `invalidateUser → bump` được đo ở C2/C3/H5a — xem X3/X4.

### 4.2 — `permission.cache.spec.ts` (thêm)

C1 `getCompanyRoleGrantsWithScope` trong ngữ cảnh memo ⇒ inner 1 lần / N gọi · C2 `invalidateUser` ⇒ lượt sau inner +1 · C3 🔴 Valkey DEL trả `false` ⇒ `invalidateUser` ném NHƯNG epoch đã bump (lượt sau inner +1) · C4 🔴(D3) `getCompanyRoleGrants` trong ngữ cảnh memo, cache Valkey trống, gọi 2 lần ⇒ inner.getCompanyRoleGrants = 2 (KHÔNG memo).

### 4.3 — Int-spec `test/integration/permission-permmemo-1.int-spec.ts` (DB thật)

Hai app Nest từ `AppModule`: **appMemo** (`app.use(requestIdMiddleware); app.use(grantMemoMiddleware)`, giống `main.ts`) và **appCtl** (không middleware = hiện trạng). Spy CALL-THROUGH trên `PermissionRepository` của TỪNG app (`app.get(PermissionRepository,{strict:false})`), lọc theo `userId` (khuôn ATTDEBT H1). Gate `hasDb && LANE_DB`, mật khẩu ghép chuỗi.

| # | Ca | Khẳng định |
| --- | --- | --- |
| H1 🔴 | PATCH `/social/posts/:id` có `attachmentIds` | appCtl ≥2 (NEO, kỳ vọng 3) · appMemo = **1** · cả hai 200 |
| H2 | GET `/social/posts/:id` 1 ảnh | appCtl ≥2 · appMemo = 1 · URL ký được (neo ALLOW thật) |
| H3 | non-SOCIAL GET `/auth/login-logs` | appCtl = 2 (NEO) · appMemo = 1 · 200 |
| H4 🔴(c) | hai actor song song HTTP: A `view:audit-log@Company`, B `view:audit-log@Own` — `view:audit-log` là cặp SENSITIVE (`auth-logs-viewer.controller.ts:33`) ⇒ B cần hàng ALLOW **exact, non-wildcard**, gieo bằng SQL; `Own` trên `login_logs` = hàng VỀ chính user (KI-070). Seed login_logs cho cả hai; spy `mockImplementation` = **chờ 25ms rồi CALL-THROUGH** để ép chồng lấn; 10 request xen kẽ `Promise.all`. Assert «A chứa hàng của B» bằng filter `user_id=B` hoặc `per_page` lớn (login thật lúc setup cũng ghi login_logs) | mọi response của B KHÔNG chứa hàng của A; response của A chứa hàng của B; số lượt spy theo userId: A = 5, B = 5 (1/request). ⚠️ Ca này chứng minh **memo KHÔNG xuyên request** (đếm A=5); tách khoá theo actor TRONG một request là việc của U13/H8 |
| H5 🔴 | thu hồi trong một request (DB thật). **Dựng tay** (DI factory `permission.module.ts:124-125` dựng memo 2 đối số, test không chạm được `now`): `const svc = new PermissionService(new CachedPermissionRepository(app.get(PermissionRepository), app.get(ValkeyService), new GrantSnapshotMemo({ now })))` (+ các phụ thuộc còn lại của constructor `PermissionService`), chạy trong `runWithGrantMemo`. `resolveStrongestScope` ⇒ scope; `UPDATE user_roles SET deleted_at` qua `direct`; trong trần (`now` giữ nguyên), chưa invalidate ⇒ còn scope (H5a-giữ: ghi nhận biên ĐÚNG như D1); `invalidateUser` ⇒ `null` (H5a); lặp lại với `now` += 2000 thay invalidate ⇒ `null` (H5b). Không có `VALKEY_URL` ⇒ `ValkeyService.del` trả `true` (`valkey.service.ts:257`) ⇒ `invalidateUser` không ném trong lane | như mô tả |
| H8 🔴(f′ HTTP) | POST bình luận task: actor có `read:task@Company`, mention user KHÔNG có `read:task` (đường `task-comments.service.ts:323`) | appMemo vẫn trả `MENTION_OUT_OF_SCOPE` (403) — memo của actor không che user được mention |
| H6 (d) | ngoài request trên app thật: gọi `app.get(PermissionService).resolveStrongestScope` ×3 ngoài ngữ cảnh | spy = 3 |
| H7 | PATCH JSON body (V1): H1 đã đo; thêm 1 route upload multipart nếu SOCIAL có | ghi kết quả; nếu mất ngữ cảnh ⇒ chỉ ghi R1, KHÔNG đỏ |

### 4.4 — Mutant (Phase D — mỗi cái PHẢI đỏ đúng thông điệp)

| # | Mutant | Ca đỏ | Thông điệp kỳ vọng (đặt sẵn trong `expect(…, msg)`) |
| --- | --- | --- | --- |
| X1 | khoá chỉ `userId` | U9 | `memo PHẢI tách công ty: (c1,u)+(c2,u) = 2 lượt đọc` |
| X2 | bỏ trần tuổi | U4, H5b | `quá trần 2000ms PHẢI đọc lại DB` |
| X3 | `invalidateUser` không bump | C2, H5a (U2 KHÔNG đỏ — nó gọi bump trực tiếp) | `sau invalidateUser lượt đọc PHẢI thấy thu hồi` |
| X4 | THÂN `bumpGrantSnapshotEpoch` = `als.getStore()?.clear()` thay vì `epoch++` | U3 | `invalidate từ outbox (ngoài request) PHẢI với tới memo của request` |
| X5 | bump đặt SAU dòng `if (!ok) throw` | C3 | `DEL lỗi vẫn PHẢI vô hiệu memo` |
| X6 | giữ promise reject | U8 | `lỗi hạ tầng KHÔNG được đầu độc phần còn lại của request` |
| X7 | trả mảng lưu trữ không clone | U10 | `caller sửa kết quả KHÔNG được đổi ảnh chụp` |
| X8 | Map cấp module thay ALS | U6, H4 | `memo KHÔNG được xuyên request: A=5 lượt` |
| X9 | có store dự phòng khi ngoài request | U7, H6 | `ngoài request PHẢI passthrough: 3 lượt` |
| X10 | epoch chụp lúc resolve | U11 | `bump khi đang bay PHẢI làm lượt sau đọc lại` |
| X11 | gỡ `app.use(grantMemoMiddleware)` ở main.ts | S1 | `main.ts PHẢI đăng ký grantMemoMiddleware` |
| X12 | memo cả `getCompanyRoleGrants` | C4 | `D3: can() path KHÔNG memo` |
| X13 | khoá chỉ `companyId` | U13, H8 | `memo PHẢI tách người dùng trong cùng công ty` |

---

## §5 — MỌI MÔ TẢ CƠ CHẾ CŨ PHẢI SỬA (grep `passthrough|KHÔNG cache|đọc thẳng|permission.cache.ts:9x` 25/09)

Văn mới thống nhất: «không cache GIỮA các request; TRONG một request HTTP được memo ≤2s (DECISIONS-15), đọc DB ở lần đầu mỗi request».

| File:dòng | Câu cũ | Sửa |
| --- | --- | --- |
| `permission/permission.cache.ts:91-94` | «passthrough (KHÔNG cache)…» | docblock mới: memo theo request, trần, epoch, D3, ADR-15 |
| `permission/data-scope.service.ts:115-116` | «KHÔNG được cache… mỗi lời gọi lẻ = một round-trip DB thật» | «…= một round-trip DB ở lần đầu mỗi request; gom batch vẫn cần cho đường ngoài request (job/WS)» |
| `permission/role-admin.service.ts:204-205` (K4) | «passthrough KHÔNG cache» | «đọc DB mỗi request (memo ≤2s TRONG request)», lập luận K4 giữ nguyên |
| `auth/auth-logs-viewer.service.ts:115-116` | «đọc thẳng DB» | «đọc DB mỗi request» |
| `auth/auth-logs-viewer.service.ts:152-153` | «không được cache (passthrough cố ý)» | ghi chú: nay memo cũng gom; giữ tách lượt vì lý do vị từ (KI-054) |
| `dashboard/dashboard-widget-registry.service.ts:207` | «(KHÔNG cache)» | «(không cache giữa request; memo ADR-15 trong request)» |
| `foundation/audit/audit.service.ts:78` | «đọc thẳng DB» | như trên |
| `recruit/recruit-access.service.ts:32-33` | «KHÔNG được cache (`permission.cache.ts:95` passthrough có chủ ý)» | như trên + bỏ số dòng cứng |
| `social/social-access.service.ts:350` ⚠️không có trong danh sách người gọi | «không cache — `permission.cache.ts:95` là passthrough có chủ ý» | như trên |
| `test/foundation/dashboard-scope-roundtrip.unit-spec.ts:5` | «DƯỚI passthrough cache (…:95 KHÔNG…» | spy ở tầng repo vẫn đúng; bỏ câu passthrough |
| `test/integration/role-member-del-oracle.int-spec.ts:27` | «(KHÔNG cache)» | «(không cache giữa request)» |
| `permission/permission.cache.ts:27-28` (docblock lớp) | chỉ tả cache Valkey | thêm đoạn memo theo request |
| `permission/permission.module.ts:108` (docblock module) | chỉ liệt kê cache Valkey | thêm memo ADR-15 |
| `permission/role-admin.service.ts:383` | «engine đọc thẳng DB» | «đọc DB mỗi request (memo ≤2s TRONG request)» |
| `auth/auth-logs-viewer.service.spec.ts:210` | «cố ý KHÔNG cache» | «không cache giữa request» |
| `permission/permission.service.ts` | đã soát: KHÔNG câu nào mô tả passthrough (`:825-831` nói «MỘT lượt đọc», vẫn đúng) | không sửa |
| `docs/RELEASE/RELEASE-02…:18-20`, `docs/plans/*` cũ | hồ sơ theo thời điểm | **KHÔNG sửa** (lịch sử) |

Bỏ mọi tham chiếu số dòng cứng `permission.cache.ts:95`; thay bằng tên hàm.

---

## §6 — RỦI RO & ROLLBACK

| # | Rủi ro | Biện pháp |
| --- | --- | --- |
| R1 | Mất ngữ cảnh ALS (multer/busboy, emitter tự chế) ⇒ memo vắng **im lặng** | Hướng an toàn (chỉ mất phần tiết kiệm). H1/H7 đo route thật; ghi route mất ngữ cảnh vào §9 |
| R2 | Tài nguyên async sống lâu (timer, kết nối lười) tạo TRONG request kế thừa store mãi mãi | khoá theo user (không chéo actor) · trần 2s · trần 64 khoá ⇒ bộ nhớ có biên |
| R3 | Lệch ≤2s trong một request (D1 đã ký) | nằm trong cửa sổ `can()` ≤5s hiện có; `decideStrongestScope` vẫn kiểm `expiresAt` mỗi lượt |
| R4 | Code tương lai ghi-rồi-đọc cùng request | luật ADR §6.3 + export `bumpGrantSnapshotEpoch` |
| R5 | 311 int-spec không đăng ký middleware ⇒ bộ hồi quy rộng chỉ phủ passthrough | memo được phủ bởi H1–H7; WO nối tiếp `S16-TEST-PIPELINE-PARITY-1` (§8) |
| R6 | Nhiều tiến trình tương lai | epoch là per-process; **trần tuổi là biên liên tiến trình** (ADR §5). PROD hôm nay 1 tiến trình (M14) |
| R7 | Hai spy count cũ đổi nghĩa | không: ATTDEBT int-spec không đăng ký middleware ⇒ số giữ nguyên; KHÔNG sửa file đó |

**Rollback:** (1) `PERMISSION_GRANT_MEMO_ENABLED=false` + restart NSSM «MediaOS-API» ⇒ hành vi byte-y-hệt hôm nay; (2) revert PR (0 migration, 0 dữ liệu).

---

## §7 — GATE

**FULL** (CLAUDE.md §6): `security-reviewer` (rò giữa request, thu hồi, bất biến #1 trong khoá) · `database-reviewer` (0 DDL, nhưng đổi ngữ nghĩa số transaction/request và RLS vẫn ép ở inner `withTenant`: xác nhận memo không bỏ qua RLS) · `silent-failure-hunter` (reject/đầu độc, mất ngữ cảnh im lặng, kill-switch) · **`santa-method`** (crown). Trước khi code: `plan-reviewer` đối kháng. Coverage ≥80% trên `grant-snapshot-memo.ts` + `permission.cache.ts` qua `test:cov:sensitive`.

---

## §8 — CẬP NHẬT BACKLOG (`harness/backlog.mjs`)

- `S16-SOCIAL-PERMMEMO-1`: `done_when[1]` VIẾT LẠI theo D1 owner (plan-review F4 — câu cũ «thu hồi giữa chừng KHÔNG được tiếp tục cho phép» mâu thuẫn H5a): «thu hồi có biên: ≤`GRANT_MEMO_MAX_AGE_MS` (2000ms) kể từ lượt đọc đầu, và bị bỏ NGAY khi `invalidateUser` chạy trong tiến trình (DECISIONS-15 §4); test đo cả hai vế (H5a/H5b)»;
  `paths` += danh sách S-1; `done_when[2]` chú thích **«LỖI THỜI: ALS có từ S10-FND-JSONLOG-1 (`common/logger/request-context.ts`); WO dùng ALS RIÊNG (D-1)»**; `notes` += «plan 25/09 · ADR-15 · trần 2000ms · epoch toàn tiến trình · kill-switch»; status theo pipeline.
- `S16-SOCIAL-PERMCOST-1`: note «PERMMEMO-1 đưa GET 1 ảnh về 1 lượt/request khi có middleware; vá cục bộ vẫn giữ giá trị cho đường ngoài request».
- Thêm WO `S16-TEST-PIPELINE-PARITY-1` (yellow, test/**): helper bootstrap int-spec áp đúng middleware của `main.ts` (R5).
- Ghi chú ATTGATE-1 M8 là lỗi thời (không sửa plan cũ; ghi ở note WO).

---

## §8.5 — SỔ PLAN-REVIEW (25/09/2026)

`plan-reviewer` (Opus): **PASS-WITH-FIXES** — thiết kế đứng vững; 8 finding đã vá VÀO plan này:
F1 HIGH khoá chỉ-`companyId` không ca nào bắt (U13 · H8 · X13) · F2 X3/X4/X5 trỏ sai ca · F3 H5 không tiêm được `now` qua DI (dựng tay) · F4 `done_when[1]` mâu thuẫn D1 (viết lại) · F5 coverage thiếu 2 spec + middleware · F6 4 comment cũ sót · F7 ngữ nghĩa trần 64 (tỉa trước, debug 1 lần) · F8 H4 cần ALLOW exact cho cặp sensitive + filter theo user.
Đã soát và KHÔNG chặn: rò ALS qua pool pg/ioredis/keep-alive (continuation giữ ngữ cảnh của bên await; socket server không có store ⇒ passthrough) · epoch chụp lúc bắt đầu + gỡ-catch theo danh tính · M11 (không có ghi-rồi-đọc cùng request) xác nhận lại.

---

## §9 — BẰNG CHỨNG ĐO THẬT

> Thi công 25/09/2026 trên lane DB cô lập `mediaos_permmemo` (`scripts/lane-db-setup.sh permmemo --reset`, chain 0000→latest áp sạch). Mọi số dưới đây là số CHẠY THẬT, chép từ log vitest.

### 9.0 — Xác minh tiền đề

- **`OUTBOX_POLL_MS` PROD** (§0.1): `.env.prod:55` = `5000` (không override lên trên 2000ms) ⇒ lập luận M9 / ADR §4 giữ nguyên.
- **ALS sống qua body-parser (M7/H7):** H1 là PATCH JSON trên appMemo và đo được **1** lượt ⇒ ngữ cảnh ALS đi qua `express.json`/raw-body. **Multer/busboy: CHƯA đo** — SOCIAL không có route multipart (tệp đi cửa presign của foundation); R1 còn mở cho `hr-import` (`FileInterceptor`) — hướng an toàn nếu mất ngữ cảnh (chỉ mất phần tiết kiệm).

### 9.1 — Phase A (RED, stub passthrough, TS xanh)

Stub `grant-snapshot-memo.ts` passthrough + middleware thật + tham số `memo` OPTIONAL ở constructor cache (chưa dùng). `pnpm --filter @mediaos/api typecheck` xanh. Chạy 5 file: **16 đỏ · 19 xanh / 35**, mọi ca đỏ là `AssertionError` đúng thông điệp (không lỗi biên dịch, không 500):

| Ca | Thông điệp đỏ THẬT (Phase A) |
| --- | --- |
| U1 | `cùng (c,u) trong một request PHẢI đọc DB đúng 1 lần: expected 3 to be 1` |
| U4 | `trong trần 2000ms PHẢI dùng memo: expected 2 to be 1` |
| U5 | `expected 4 to be 2` |
| U8 | `expected 2 to be 1` (vế single-flight: 2 caller đồng thời) |
| U10 | `expected 3 to be 1` (số lượt inner) |
| U12 | `expected 65 to be 64` |
| C1 | `getCompanyRoleGrantsWithScope PHẢI đi qua memo trong request: expected "spy" to be called 1 times, but got 3 times` |
| S1 ×2 | `main.ts PHẢI đăng ký grantMemoMiddleware: expected -1 to be greater than -1` · `env.schema PHẢI khai PERMISSION_GRANT_MEMO_ENABLED: expected undefined to be defined` |
| middleware | `next() PHẢI chạy trong ngữ cảnh memo của middleware: expected 2 to be 1` |
| H1 | `PATCH đính kèm: appCtl=2 · appMemo PHẢI = 1: expected 2 to be 1` |
| H2 | `GET 1 ảnh: appCtl=2 · appMemo PHẢI = 1: expected 2 to be 1` |
| H3 | `login-logs: appCtl=2 · appMemo PHẢI = 1: expected 2 to be 1` |
| H4 | `memo KHÔNG được xuyên request: A=5 lượt: expected 10 to be 5` |
| H5a / H5b | `H5a-giữ: trong trần 2000ms ảnh chụp còn hiệu lực (D1): expected null to be 'Company'` · `trong trần còn scope: expected null to be 'Company'` |

Xanh ở Phase A (đúng thiết kế — chúng là lưới HỒI QUY, không phải ca RED): U2 · U3 · U6 · U7 · U9 · U11 · U13 · C2 · C3 · C4 · H6 · H8 ×2 (passthrough vốn đã «đúng» ở các vế này; chúng cắn MUTANT ở §9.3).

### 9.2 — Số đếm TRƯỚC / SAU (spy CALL-THROUGH trên `PermissionRepository`, lọc theo userId)

| Ca | appCtl (không middleware = hiện trạng) | appMemo (như `main.ts`) | Kỳ vọng plan |
| --- | --- | --- | --- |
| H1 PATCH bài có `attachmentIds` | **2** | **1** | trước 3 ⇒ ⚠️ LỆCH: thực đo **2** vì PERMCOST-1 (#543) đã gộp một lượt trước WO này. Neo `≥2` vẫn đúng |
| H2 GET bài 1 ảnh | **2** | **1** | khớp |
| H3 GET `/auth/login-logs` | **2** | **1** | khớp |
| H4 10 request song song (A @Company, B @Own) | A=**10** · B=**10** (Phase A, 2 lượt/request) | A=**5** · B=**5** (1/request) | khớp; mọi response B KHÔNG chứa hàng của A, A THẤY hàng của B |

### 9.3 — Mutant X1–X13 (Phase D — áp TỪNG CÁI, chạy ca nêu tên, khôi phục bằng bản sao, `diff -q` xác nhận mã sản phẩm đã về nguyên trạng)

| # | Mutant (đã áp) | Ca đỏ THẬT | Thông điệp đỏ THẬT |
| --- | --- | --- | --- |
| X1 | `const key = userId` | U9 | `memo PHẢI tách công ty: (c1,u)+(c2,u) = 2 lượt đọc: expected [ { action: 'view', …(5) } ] to deeply equal []` |
| X2 | `isFresh` bỏ vế tuổi | U4 · H5b (+U12 phụ) | `quá trần 2000ms PHẢI đọc lại DB: expected 1 to be 2` · H5b `quá trần 2000ms PHẢI đọc lại DB: expected 'Company' to be null` |
| X3 | bỏ `bumpGrantSnapshotEpoch()` ở `invalidateUser` | C2 · C3 · H5a (U2 xanh — đúng dự đoán) | `sau invalidateUser lượt đọc PHẢI thấy thu hồi: expected "spy" to be called 2 times, but got 1 times` · H5a `…: expected 'Company' to be null` |
| X4 | thân bump = `als.getStore()?.perMemo.clear()` | U3 (U2 xanh — đúng dự đoán) | `invalidate từ outbox (ngoài request) PHẢI với tới memo của request: expected 1 to be 2` |
| X5 | bump dời xuống SAU `if (!ok) throw` | C3 | `DEL lỗi vẫn PHẢI vô hiệu memo: expected "spy" to be called 2 times, but got 1 times` |
| X6 | bỏ `entry.promise.catch(…delete…)` | U8 | `lỗi hạ tầng KHÔNG được đầu độc phần còn lại của request: expected Error: db down to deeply equal [ … ]` |
| X7 | trả promise lưu trữ, không clone | U10 | `caller sửa kết quả KHÔNG được đổi ảnh chụp: expected [ {…}, …(1) ] to deeply equal [ {…} ]` |
| X8 | store cấp module thay ALS (trong request) | U6 · H4 (+H2 · H5b phụ) | `memo KHÔNG được xuyên request: A=5 lượt: expected 1 to be 2` · H4 `…: expected +0 to be 5` |
| X9 | store dự phòng khi ngoài request | U7 · H6 (+neo H1–H3 phụ) | `ngoài request PHẢI passthrough: 3 lượt: expected 1 to be 3` (cả U7 và H6) |
| X10 | epoch chụp lúc RESOLVE | U11 (+U8 phụ) | `bump khi đang bay PHẢI làm lượt sau đọc lại: expected 1 to be 2` |
| X11 | gỡ khối `app.use(grantMemoMiddleware)` ở `main.ts` | S1 | `main.ts PHẢI đăng ký grantMemoMiddleware: expected -1 to be greater than -1` |
| X12 | memo cả `getCompanyRoleGrants` | C4 | `D3: can() path KHÔNG memo: expected "spy" to be called 2 times, but got 1 times` |
| X13 | `const key = companyId` | U13 · H8 (+U12 phụ) | U13 `memo PHẢI tách người dùng trong cùng công ty: expected 'Company' to be null` · H8 `memo PHẢI tách người dùng trong cùng công ty: {…201, mentions:[…]}: expected 201 to be 403` — tức actor MENTION được người không có `read:task` |

13/13 đỏ đúng thông điệp. Sau mỗi mutant: `diff -q` bản sao ↔ `grant-snapshot-memo.ts` / `permission.cache.ts` / `main.ts` = giống hệt.

### 9.4 — Coverage (`test:cov:sensitive`, LANE_DB, 79 file / 1162 ca xanh)

| File | Stmts | Branch | Funcs | Lines |
| --- | --- | --- | --- | --- |
| `src/permission/grant-snapshot-memo.ts` | 100 | 100 | 100 | 100 |
| `src/permission/permission.cache.ts` | 89.92 | 83.87 | 90 | 89.92 |
| `src/common/middleware/grant-memo.middleware.ts` | 100 | 100 | 100 | 100 |

Đọc tay ≥80% cả ba (script không có cờ ngưỡng — đúng như §2).

### 9.5 — Lệch plan (ghi thẳng, không lặng lẽ)

1. **H1 «trước = 3» → thực đo 2** (PERMCOST-1 đã gộp một lượt). Không đổi thiết kế; neo `≥2` giữ.
2. **H5 dùng Valkey GIẢ (`del → true`), không `app.get(ValkeyService)`.** Plan giả định lane không có `VALKEY_URL`; thực tế `loadEnv()` đọc `.env` gốc ⇒ client ioredis thật với `lazyConnect:true` + `enableOfflineQueue:false` ⇒ DEL ĐẦU TIÊN trên client lạnh trả `false` ⇒ `invalidateUser` ném `Valkey DEL failed…`. Nhánh DEL-lỗi đã có C3 đo (và X5). ⚠️ Quan sát CHƯA xác minh ở PROD: cùng hình dạng client ⇒ lệnh Valkey đầu tiên sau boot có thể thất bại trước khi kết nối xong — hành vi có sẵn, ngoài phạm vi WO.
3. **Phase A không «0 dòng mã sản phẩm» tuyệt đối:** thêm tham số `memo` OPTIONAL (chưa dùng) vào constructor `CachedPermissionRepository` để ca H5 dựng tay biên dịch được; middleware viết bản thật ngay (1 dòng, đỏ nhờ memo stub).
4. **Hình dạng store:** `{ perMemo: Map<GrantSnapshotMemo, Map<string, Entry>>, capLogged }` thay vì `Map` trần — cần chỗ cho cờ «debug 1 lần mỗi store» (D-2). X4 vì vậy là `als.getStore()?.perMemo.clear()`.
5. **U8** dùng `.catch((e) => e)` ở lượt thứ hai để mutant X6 đỏ ở assert CÓ thông điệp (bản đầu đỏ bằng `Error: db down` trần — đúng lớp «mutant đỏ phải khớp thông điệp»).
6. **H7**: không có route multipart SOCIAL ⇒ không đo (xem 9.0).
7. `test:cov:social` KHÔNG chạy riêng; chạy int-spec ATTDEBT (`social-attdebt-1-cost-alert.int-spec.ts`) = **8/8 xanh**, số spy-count cũ giữ nguyên (R7); `harness/check.sh --lane-db=permmemo` chạy toàn suite (9.6).
8. Comment §5: ngoài bảng, sửa thêm 0 file; mọi mục trong bảng đã sửa (grep lại `permission.cache.ts:9` · `passthrough có chủ ý` · `passthrough cố ý` · `passthrough KHÔNG cache` = 0 hit).

### 9.6 — Cổng cuối

- `pnpm --filter @mediaos/api typecheck` = xanh · `lint` = 0 lỗi (warning có sẵn, không file nào của WO).
- `bash harness/check.sh --lane-db=permmemo` lượt 1 = **ĐỎ 1 ca thật**: ratchet `supertest-listen-ratchet.unit-spec.ts` (S18-QA-SUPERTESTLISTEN-1) bắt int-spec mới bắn supertest trong `Promise.all` (H4) mà app chưa `listen(0)`. Sửa root-cause: init + `listen(0)` cả hai app ở `beforeAll` (census đọc theo tên biến, `afterAll` đã `close()`). Chạy lại 5 mutant dùng int-spec (X2 · X3 · X8 · X9 · X13) sau sửa: vẫn đỏ đúng thông điệp.
- Lượt 2: **`XANH ✅`** — `@mediaos/api: 784/784 file chạy · 2 lần chạy lại (crash hạ tầng)`, mọi package xanh, `exit=0`.
