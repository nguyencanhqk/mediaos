# Plan — S6-SEC-1 · Security / RBAC / Data-Protection final hardening (Sprint 6 · WS4 · 🔴 crown)

> Work Order `S6-SEC-1` · zone **red** · gate **FULL**. Khung: `IMPLEMENTATION-09` §13
> (§13.2 checklist 5 nhóm · §13.3 ma trận quyền tối thiểu · §13.4 security release gate).
> Luật: `RELEASE-05` (freeze §2 · change-control §4 · thang `S0…S4` §5).
> Base: `master` `c845a777` · migration head `0529` (197).
>
> **Bản 2** — vá 8 chặn của `plan-reviewer` vòng 1. Thay đổi lớn nhất: tiền đề về lưới
> `route-guard-coverage` ở bản 1 **SAI**, và cái sai đó nằm đúng chỗ sinh ra deliverable D3 (§3.1).

---

## 1. WO này trả lời câu gì

Đúng một câu: **"còn lỗ CRITICAL/HIGH nào mở trước khi đóng băng RC không?"** — trả lời bằng bằng
chứng chạy lại được, không bằng cảm nhận.

| # | Đầu ra | Nơi |
| --- | --- | --- |
| D1 | Checklist §13.2 (30 mục / 5 nhóm) chấm hết, mỗi ô `T`/`C`/`L`/`N/A`/`GAP` | `docs/_review/S6-SEC-1-SECURITY-HARDENING-2026-07-26.md` |
| D2 | §13.3 (10 case × 5 vai) + §13.4 (7 điều kiện chặn go-live, mỗi cái một phép thử) | cùng file |
| D3 | Phán quyết **từng dòng** cho mọi route không `@RequirePermission` — **tự đo trong WO này** | cùng file, Phụ lục A |

---

## 2. Cái ĐÃ CÓ — không làm lại (chỉ trích dẫn)

Rủi ro lớn nhất là **viết lại một bản sao của `S5-SEC-1`**. Đã có, KHÔNG lặp:

| Đã phủ | Ở đâu | WS4 làm gì thêm |
| --- | --- | --- |
| Ma trận data-scope 5 scope × 7 module | `S5-SEC-1-PERM-SCOPE-SUITE` | Ánh xạ sang **định dạng §13.3**, chỉ lấp ô §13.3 hỏi mà S5 không có |
| OWASP API Top 10 · D1/D2/D3 accepted-risk | `_review/S5-SEC-1-SECURITY-TESTING-2026-07-25` | **Carry-forward tường minh** (§2.1), không viết lại |
| RLS + FORCE + policy 2 vế mọi bảng `company_id` | `rls-coverage-assert` · `rls-guards` | Chạy lại + ghi số đo |
| Append-only | 9 file, **3 kiểu tên** (§4 Bước 5) | Đối chiếu danh sách thiết kế ↔ grant THẬT |
| Guard coverage tĩnh | `route-guard-coverage.e2e-spec` | Dùng làm đầu vào, **và vá lưới của nó** (§3.1) |

### 2.1 Carry-forward rủi ro đã chấp nhận của S5 (không âm thầm mở lại, không âm thầm đóng)

| Mã | Nội dung | Ánh xạ §13 | Trạng thái phải ghi trong D1 |
| --- | --- | --- | --- |
| **D3** (KI-012) | Widget `hr-overview` count-only xuyên phòng ban cho HR scope Department | **§13.4 #4** (dashboard lộ số liệu ngoài scope) | **CHƯA CÓ CHỮ KÝ** — điều kiện `C4` của `RELEASE-01` §10. WS4 **không** tự ký, chỉ ghi là gate #4 đang phụ thuộc chữ ký |
| **D1** (KI-013) | `refresh`/`resetPassword` không throttle | §13.2 API-security #1 | Accepted theo thiết kế; WS4 xác nhận mitigation còn nguyên (reuse-detection + token hash single-use) |

---

## 3. Cái WS4 phải làm MỚI

### 3.1 ĐÍNH CHÍNH tiền đề bản 1 — lưới `route-guard-coverage` thủng ở GET

Bản 1 viết: *"`route-guard-coverage` chỉ chặn route mới trong controller đã có ý định gate"*. **Đúng
một nửa và thiếu vế nguy hiểm hơn:** [route-guard-coverage.e2e-spec.ts:148](apps/api/test/foundation/route-guard-coverage.e2e-spec.ts#L148)
lọc `.filter((r) => r.httpMethod !== "GET")` ⇒ **mọi route ĐỌC nằm ngoài lưới**, kể cả trong controller
đã gate. Mà §13.4 #1 (đọc dữ liệu người khác) chính là lớp **đọc**.

Đã xác minh một trường hợp thật trước khi viết plan này (không lấy từ báo cáo của reviewer):
[org.controller.ts:173](apps/api/src/org/org.controller.ts#L173) `GET /org/employees` không
`@RequirePermission`; [org.repository.ts:322](apps/api/src/org/org.repository.ts#L322) `listEmployees()`
trả `id · email · fullName · status` + team membership của **toàn bộ user trong tenant** cho **mọi user
đã đăng nhập**. Docstring controller biện minh "cơ cấu tổ chức không nhạy cảm" — nhưng đây là **danh bạ
người dùng kèm email**, không phải cơ cấu tổ chức. Đối chiếu §13.3 dòng 2 (*"Xem danh sách nhân viên:
Employee = Không hoặc Own"*) và `employees-rbac-scope.int-spec:247` (Employee Own **chỉ** thấy hồ sơ
mình) ⇒ **hai đường đọc cùng một tập người, hai mức gác khác nhau**. Phân mức để §4 Bước 2 quyết.

⇒ **D3 phải tự đo lại toàn bộ route (mọi HTTP method) trong chính WO này**, không tin con số 35 từ
nhánh `qa/S6-QA-FINAL-1` chưa merge, và phải tách riêng tiểu mục *"GET không gate trong controller đã
gate"*.

### 3.2 Delta còn lại

| # | Việc | Vì sao chưa ai làm |
| --- | --- | --- |
| N1 | Phán quyết mọi route không-gate (§4 Bước 2) | §3.1 |
| N2 | Nhóm **Authentication/session** (7 mục) | S5 tập trung authorization; TTL · revoke · logout-clear · locked-no-access · reset-token-hash chưa gom thành checklist |
| N3 | Nhóm **Secret/config** (5 mục) + **cờ đọc thẳng `process.env`** | `.env.example` ↔ `env.schema` ↔ seed chưa ai đối chiếu; và **`PERMISSION_GUARD_ENABLED` KHÔNG nằm trong `env.schema.ts`**, đọc thẳng tại [permission.guard.ts:58](apps/api/src/permission/guards/permission.guard.ts#L58) — đặt nhầm ở PROD = **fail-open toàn hệ**, chỉ có 1 dòng WARN |
| N4 | Nhóm **API security** (6 mục) | Rate-limit · 422 · stack-trace prod · CORS · Idempotency-Key rải rác |
| N5 | §13.4 — 7 điều kiện chặn go-live thành 7 phép thử | Chưa ai chạy đúng 7 câu này |

---

## 4. Các bước (thứ tự bắt buộc)

**Bước 0 — plan-reviewer PASS.** Crown ⇒ không sửa một dòng nào trước khi plan PASS.

**Bước 0b — sửa `paths` của WO trước khi bắt đầu** (`paths` lái gate + scheduler — memory
`wo-paths-drive-gate-and-scheduler`). Hiện thiếu `docs/RELEASE/**` (plan hứa cập nhật RELEASE-01/02) và
`harness/backlog.mjs` (CLAUDE §8). Không thêm `apps/app/**`: xem Bước 3b.

**Bước 1 — DB cô lập + nền bằng chứng.** `bash scripts/lane-db-setup.sh s6sec1` → `LANE_DB=mediaos_s6sec1`,
chunk 20 file + `--no-file-parallelism` (bắt buộc — `S6-QA-FINAL-1` §2.1), `TURBO_FORCE=1` cho
lint/typecheck/build.

*Nhãn `T` phải falsifiable* (chặn B6). Một ô chỉ được `T` khi có **đủ ba**: (a) file + tên `it()`
nguyên văn; (b) dòng PASS trong log của **chính lần chạy này**; (c) file đó nằm trong bảng tổng
"file chạy / fail / skip" của D1. D1 phải liệt kê **mọi** skip kèm lý do — nếu int-spec bị `skipIf`
vượt ngưỡng thì kết luận là **"XANH KHÔNG ĐỦ BẰNG CHỨNG"**, không phải "xanh" (CLAUDE §9.5).

**Bước 2 — N1: đo + phán quyết route không-gate.** Sáu ô, không phải bốn:

| Phán quyết | Nghĩa | Bằng chứng bắt buộc |
| --- | --- | --- |
| `SELF` | Service ép chủ thể từ token, không nhận id từ client | file:dòng chỗ ép `req.user.id` |
| `PUBLIC` | Cố ý mở (`@Public()`, health, login) | đối chiếu spec |
| `OTHER_GUARD` | Gác bằng guard khác `PermissionGuard` (`InternalGuard`, `LmsServiceIntakeGuard`, `ReauthGuard`) | tên guard + file:dòng + chứng minh nhánh **fail-closed** |
| `TENANT_READ` | Đọc mở cho mọi user trong tenant theo quy ước nhà | đối chiếu §13.3 + SPEC. Kết quả là **ACCEPTED-cần-chữ-ký-owner** *hoặc* `GAP` — **không** được tự cho qua |
| `PARKED` | Module đã park (CONTENT/media) | nguồn là **CLAUDE §1 + `RELEASE-05` §2.4**, KHÔNG phải `MUTATION_BASELINE` (danh sách đó theo cấu tạo chỉ chứa mutation của 1 controller). Vẫn phải ghi **khả năng khai thác** + đề xuất owner: gỡ mount hay gate cấp class trước RC |
| `GAP` | Không thuộc 5 ô trên ⇒ **finding**, phân mức `S0…S4` | truy vấn/lệnh **tái lập được** |

> Cảnh báo giữ từ bản 1 (reviewer xác nhận ĐÚNG): "không `@RequirePermission`" **không** đồng nghĩa
> "không gác" — `JwtAuthGuard`/`CompanyGuard` là `APP_GUARD` toàn cục
> ([app.module.ts:103-105](apps/api/src/app.module.ts#L103)), và `PermissionGuard` fail-closed 403 khi
> thiếu metadata ([permission.guard.ts:74-81](apps/api/src/permission/guards/permission.guard.ts#L74))
> **nhưng chỉ trong controller có `@UseGuards`** — nó KHÔNG global. Phán quyết dựa trên **service có ép
> chủ thể hay không**, không dựa trên sự vắng mặt của decorator.

**Bước 3 — N2/N3/N4.** Mỗi mục cần `T` hoặc `C`; không có ⇒ `GAP`.

*Caveat bắt buộc cho N2* (chặn B7): [vitest.config.ts:30](apps/api/vitest.config.ts#L30) đặt
`TWO_FACTOR_ENFORCEMENT_ENABLED: "false"` cho **toàn suite** (kèm `JWT_SECRET` cố định,
`ALLOW_SUPERUSER_ROTATION: "true"`). Ô nào của N2 dựa vào suite này phải ghi caveat "chấm dưới cấu hình
đã tắt một lớp gác"; ít nhất **một** assertion phải chạy với guard BẬT tường minh, nếu không thì hạ
xuống `C` + kiểm cấu hình PROD.

*N3 phải grep `process.env[` toàn `apps/api/src`* (chặn B8), liệt kê mọi cờ ảnh hưởng bảo mật, và với
mỗi cờ khẳng định **hoặc** được zod validate **hoặc** vắng mặt trong env PROD (kiểm thật).

**Bước 3b — hai mục §13.2 là việc FRONTEND** (RBAC #4 "direct URL bị FE guard" · #7 "không hard-code
role ở FE"). `paths` của WO **không** có `apps/app/**` ⇒ không sửa FE ở đây. Chấm bằng phép kiểm **có
tên**: quét `apps/{app,console,auth}/src` + `packages/*` tìm so sánh với tên role hệ thống; kết quả ghi
`C` (kèm số file dùng `PermissionGate`/`useCan`) hoặc `GAP`. **Không** đếm 2 ô này vào "30/30" nếu
không chấm được — DoD ghi số thật.

**Bước 4 — §13.3 + §13.4.** §13.3 phải **khai luật N=1 trước** (System ≡ Company tại runtime;
`S5-SEC-1-PERM-SCOPE-SUITE` chú giải ⁶) để cột Super Admin không thành ô độn. §13.4 #7 (seed/migration
tạo admin mật khẩu mặc định) phải nhắm **PROD**: memory `funtime-prod-hr-import` ghi 45 nhân viên PROD
import bằng **mật khẩu tạm chung** ⇒ kiểm tường minh "ép đổi lần đầu + không còn tài khoản nào giữ mật
khẩu mặc định", không chỉ soi seed trong repo.

**Bước 5 — re-verify 3 bất biến.**

1. `company_id`/RLS — `rls-coverage-assert` + `rls-guards` + `tenant-isolation`, ghi số đo.
2. Append-only — **liệt kê tường minh 9 file, 3 kiểu tên** (đừng dùng glob `*-appendonly.int-spec`, nó
   chỉ khớp 6 — bẫy `coverage-audit-scan-both-globs`): kể cả
   `src/foundation/company/company-users-append-only.int.spec.ts` (colocated, đuôi `.int.spec.ts`),
   `test/integration/notification-delivery-append-only.int-spec.ts`,
   `test/integration/salary-profile-appendonly-audit.int-spec.ts`. Rồi đối chiếu danh sách bảng thiết kế
   (CLAUDE §2.2) với `information_schema.role_table_grants` **trên cả lane DB VÀ PROD (read-only)** —
   bất biến phải đúng ở PROD, nơi đã từng có drift.
3. Không secret plaintext — `gitleaks` + quét DTO/log route nhạy cảm.

**Bước 6 — fix.** CHỈ khi có finding `CRITICAL`/`HIGH`. Ràng buộc (bản 1 tự mâu thuẫn — vá ở đây):

- **RED trước** (deny-path đỏ trước khi sửa) — CLAUDE §6.
- **Chiều expand-contract khi SIẾT quyền** (ngược với revoke): grant/seed cho mọi role hợp lệ **trước**
  (release N) → mới enforce (release N+1). Bản 1 vừa đòi "cặp quyền đã seed" vừa cấm "đụng seed" ⇒ kẹt.
  Luật thật: **nếu cặp quyền chưa được grant đủ cho các role hợp lệ thì KHÔNG fix trong WO này** — ghi
  finding + mở WO riêng.
- **Kiểm grant theo TỪNG ROLE trên DB PROD**, không chỉ "cặp có trong seed" (bài học
  `blanket-grant-migration-role-drift`: role sinh sau migration `CROSS JOIN` không có grant ⇒ 403 chỉ
  xảy ra ở PROD).
- **Kiểm kê caller FE trước khi siết**: `GET /org/units|roles|employees` là nguồn dropdown của nhiều
  màn; siết mù = gãy UI. Grep `apps/{app,console,auth}` + `packages/web-core`.
- **Đường lùi**: kill-switch duy nhất hiện có là `PERMISSION_GUARD_ENABLED=false` → fail-open **toàn
  hệ**, KHÔNG dùng được để rollback một route ⇒ mỗi fix siết phải tự có đường lùi (revert commit).
- Chạm `permission`/`RLS`/`auth`/`audit` ⇒ FULL gate, **không** tự merge.
- **Không migration** trừ khi finding bắt buộc; nếu bắt buộc → RLS/FORCE **trước** backfill, và revoke
  grant phải tách 2 release (`migration-expand-contract-required`) sau khi đã grep call-site tìm
  **writer còn sống**.
- Mỗi CR sinh ra phải **map về một flow `CF-xx`** (`RELEASE-05` §4.4: không trỏ được ⇒ mặc định từ chối).

**Bước 7 — FULL gate.** `security-reviewer` + `silent-failure-hunter` + `rls-tenant-isolation-tester`
(bắt buộc theo `done_when`). Thêm **`database-reviewer`** nếu chạm DB/migration/grant và
**`santa-method`** nếu có fix crown (CLAUDE §6). PASS hết mới mở PR.

---

## 5. Bất biến, rủi ro, phối hợp

| Rủi ro | Chặn bằng |
| --- | --- |
| **Siết quyền quá tay → 403 storm PROD** | Bước 6: expand-contract chiều siết + kiểm grant per-role trên PROD + kiểm kê caller FE + có đường lùi. Không đủ 4 thứ đó ⇒ **không fix, chỉ ghi finding** |
| Kết luận D3 sai vì tin lưới thủng | §3.1 — tự đo lại mọi method, tách riêng nhóm GET |
| **Hai WO song song cùng đụng `apps/api/test/**`** | `S6-QA-FINAL-1` (PR #294) đang mở và đã sửa `test/foundation/foundation-audit.e2e-spec.ts` + `src/attendance/attendance-adjustment.int.spec.ts`. WO này **không đụng 2 file đó**; nếu #294 vào master trước thì rebase. Vi phạm CLAUDE §9.1 (1 WO/phiên) là **có chủ ý và có rào**, ghi ra thay vì giấu |
| Tin số liệu từ nhánh chưa merge | Không trích `KI-025` cho tới khi #294 lên master; mọi số của D3 tự đo |
| Reviewer PASS nhưng bug thật lọt | Mỗi finding kèm **truy vấn/lệnh tái lập** (`reviewers-pass-real-bugs`) |
| Kết luận sai từ chú thích code | Chú thích **không** phải bằng chứng — verify bằng code + `git log` (`wo-plans-built-on-code-comments`; QA-F02 vừa dính) |
| Fixture giống-secret trip gitleaks | Ghép chuỗi / lấy từ env (CLAUDE §5) |

**Ánh xạ mức** (`RELEASE-05` §5.2): `S0` ≡ CRITICAL · `S1` ≡ HIGH · `S2` ≡ Major. Luật nâng tự động:
**thiếu audit cho thao tác nhạy cảm ⇒ tối thiểu `S1`** (liên quan trực tiếp `done_when` #2). Ngưỡng RC:
`S2` mở ≤ 3 (`RELEASE-05` §5.3) — hiện đã vượt, WS4 không được làm vượt thêm mà không ghi.

**Không được phá:** 3 bất biến. WO này chỉ làm hệ **chặt hơn hoặc bằng**, tuyệt đối không nới.

---

## 6. Khi nào DỪNG cho người

- Finding `S0` (lộ dữ liệu chéo tenant / bypass auth) ⇒ **dừng, báo owner ngay**, không tự vá.
- Finding `S1`/HIGH: được sửa **chỉ khi** đủ 4 điều kiện an toàn ở Bước 6; thiếu bất kỳ điều nào ⇒ ghi
  finding + đề xuất WO, để owner quyết. `RELEASE-05` §4.1 đòi **Security Owner duyệt** cho security fix —
  trong dự án một-owner, đó là owner: **PR không tự merge**.
- Số `S1`/HIGH > 3 ⇒ dừng, xin owner ưu tiên thay vì vá hết trong một PR crown.
- Fix cần migration đụng grant/policy ⇒ dừng, xin quyết định (đụng `S6-PERF-DB-1` đang chờ).
- Reviewer BLOCK ⇒ sửa rồi chạy lại, **không** override.
- Không có quyền truy vấn read-only PROD ⇒ **không bịa**: hạ kết luận Bước 5.2 và §13.4 #7 xuống
  "chỉ chứng minh trên lane DB" và ghi đó là **giới hạn tường minh** của D1.

---

## 7. Definition of Done

- [ ] §13.2 — chấm hết 30 mục; **ghi số thật** (28 mục API + 2 mục FE chấm theo Bước 3b), không làm tròn thành "30/30"
- [ ] §13.3 — 10 case × 5 vai, có khai luật N=1 trước
- [ ] §13.4 — 7 điều kiện, mỗi cái một phép thử; #4 ghi rõ phụ thuộc chữ ký D3, #7 nhắm PROD
- [ ] D3 — **tự đo**, phán quyết từng route theo 6 ô, tách riêng nhóm "GET không gate trong controller đã gate"
- [ ] 3 bất biến re-verify bằng số đo (append-only: 9 file 3 kiểu tên + grant thật)
- [ ] 0 finding `CRITICAL`/`HIGH` **mở** — hoặc đã fix, hoặc có quyết định tường minh của owner
- [ ] FULL gate PASS (3 reviewer bắt buộc + `database-reviewer`/`santa-method` nếu kích hoạt)
- [ ] `RELEASE-02` cập nhật; `RELEASE-01` §5 cập nhật nếu trạng thái đổi; **`harness/backlog.mjs` cập nhật** (CLAUDE §8)
- [ ] **Kịch bản "0 finding" là kết quả hợp lệ** — nếu không tìm ra gì, D1 vẫn phải chứng minh đã tìm ở đâu; KHÔNG chế finding cho đẹp báo cáo
