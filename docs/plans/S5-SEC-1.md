# S5-SEC-1 — Permission & data-scope hardening + field/export perm + security testing (WS-E · 🔴 crown)

> Zone **red / crown**. FULL gate (`security-reviewer` + `silent-failure-hunter` +
> `rls-tenant-isolation-tester`). Plan-reviewer **PASS bắt buộc TRƯỚC khi sửa** (CLAUDE.md §6).
> Nguồn: IMPLEMENTATION-08 §14 · ISSUE-BOARD-01 §18 (QA-PERM-001/QA-SEC-001) · QA-05 · QA-06 ·
> `docs/permission-matrix-spec.md` · IMP02-STORY-104/107/109.
>
> **v2 (2026-07-25)** — vá theo plan-reviewer: D2 export **đính chính** (endpoint export CÓ tồn tại +
> đã test); audit lại trên **CẢ HAI** glob spec; QA-PERM-001 = ma trận §14.2 **5-scope × 7-module đầy đủ**
> (khác checklist §14.3); danh sách gap thu về **1 test thật (G1)** sau khi đọc spec colocated.

---

## 1. Kết luận khảo sát (đo trên CẢ HAI lớp spec)

vitest include **hai** lớp integration spec (`vitest.config.ts:47`): `src/**/*.spec.ts` (colocated, gồm
**41** file `*.int.spec.ts`) **và** `test/**/*.int-spec.ts` (**210** file). Corpus thật ≈ **251**, KHÔNG phải
210. Hai agent khảo sát vòng-1 chỉ đọc lớp `test/**` ⇒ kết luận vòng-1 (11/13, 4/6, gap G1–G5) **chưa
đủ tin**. Đọc bổ sung lớp colocated đã lật 4/5 "gap":

| "Gap" vòng-1 | Sự thật sau khi đọc colocated | Nguồn |
| --- | --- | --- |
| G3 manager xem công phòng khác (HTTP scope) | **COVERED** | `src/attendance/attendance-be2.int.spec.ts:280` (manager /team-records = reports∪self, non-report excluded) + `:292` (/records → 403 no view-company) · `attendance-be6.int.spec.ts:267` (reports/team own-team-only) |
| G4/§14.3-#7 widget gate nguồn | **COVERED** (đúng hướng #7) | `dashboard-widget-security.int-spec.ts:530` (thiếu `read:project` ⇒ 403, `listByProject` KHÔNG gọi = gate TRƯỚC aggregate) · `dashboard-widget-catalog2-security.int-spec.ts` (403/slug thiếu grant) |
| G5 employee approve-leave → 403 | **COVERED** | `src/leave/leave-approval.int.spec.ts:352` ("employee (no view/approve/reject grant) → 403 on GET /requests + approve + reject") |
| D2 export = "N/A không có endpoint" | **SAI** — export CÓ + đã test (xem §2 D2) | `attendance-export.int.spec.ts`, `hr-export.int.spec.ts` |

**Kết luận đính chính:** bề mặt §14 (permission/data-scope/IDOR/file/**export**/masking/3 bất biến) **về
cơ bản đã được phủ** bởi corpus 251 spec. Giá trị THẬT của WO này = **(a) thực thi + lập bản đồ** ma trận
§14.2 làm bằng chứng (QA-PERM-001), **(b) báo cáo bảo mật** QA-SEC-001, **(c) bịt 1 lỗ hổng thật còn lại
(G1 deep-link)**. **Test-only + docs — KHÔNG sửa `src` sản phẩm, không migration, không grant mới** ⇒ 3 bất
biến không suy yếu.

Idiom chuẩn: [`me-qa1-idor-sweep.int-spec.ts`](../../apps/api/test/integration/me-qa1-idor-sweep.int-spec.ts)
— HTTP đầy đủ qua chuỗi guard thật, seed multi-tenant qua `directPool`, `assertNoSecrets`, IDOR param-tamper.

---

## 2. Quyết định phạm vi (KHOÁ — đưa vào QA-SEC-001 để owner ký)

| # | Vấn đề | Quyết định | Lý do |
| --- | --- | --- | --- |
| **D1** | Rate-limit `refresh` + `resetPassword` KHÔNG throttle | **KHÔNG thêm throttle mới vào `auth.service.ts`.** QA-SEC-001 ghi rõ mitigation: `refresh` = reuse-detection + `FOR UPDATE`; `reset` = token **high-entropy, lưu HASHED, dùng-một-lần, hết hạn ngắn**. G2 assert hành vi hiện có. | Thêm throttle vào auth crown suy đoán = phá YAGNI + tăng bề mặt rủi ro. Đã có throttle THẬT cho login/forgot/2FA-verify/change-password (`login-rate-limiter.ts`). |
| **D2** | "export permission" (done_when #2) | **Export CÓ tồn tại + đã test — KHÔNG phải N/A.** 3 đường: `GET /attendance/records/export` (`export:attendance` sensitive), `GET /hr/employees/export` (`export:employee` sensitive, **per-row PII mask** + salary KHÔNG phải cột export), `GET /leave/reports` (`export:leave` Company-only, JSON). Map vào QA-PERM-001; QA-SEC-001 ghi export = scope-filter + PII-mask + CSV-injection-neutralize + cross-tenant + row-cap 422 + append-only audit. | `hr-read.controller.ts:65-83`, `attendance.controller.ts:140-156`, `leave-report.controller.ts:30-53`. Coverage: `src/employees/hr-export.int.spec.ts` + `hr-export.csv.spec.ts` + `hr-export.service.spec.ts`; `src/attendance/attendance-export.int.spec.ts` + `.service.spec.ts`. |
| **D3** | NEG-PERM-005 — HR Department-scope trên `hr-overview` | Assert widget-gate; **ghi ACCEPTED-RISK tường minh trong QA-SEC-001** (mục riêng để owner ký): "viewer có quyền widget thấy count **company-wide** dù scope Department — chấp nhận ở MVP vì count-only + PII-masked + DASH chỉ gate hiển thị". | `permission-matrix §7`: DASH gate hiển thị; module nguồn ép data-scope. `dashboard-widget-security S4/S7b`: hr-overview count-only, viewer-independent, no salary/PII. NEG-PERM-005 cho phép "403 HOẶC scoped đúng"; đúng chữ nhưng phải để owner quyết. |

---

## 3. Deliverables

### 3.1 QA-PERM-001 — ma trận §14.2 5-scope × 7-module + checklist §14.3 + NEG-PERM (bằng chứng chạy được)
`docs/QA/evidence/S5-SEC-1-PERM-SCOPE-SUITE.md`. **Đây là deliverable CHÍNH** (done_when #1 + #3). Ba bảng
TÁCH BẠCH (reviewer nhấn: §14.2 ≠ §14.3):

- **Bảng A — Ma trận §14.2: {Own·Team·Department·Company·System} × {AUTH·HR·ATT·LEAVE·TASK·DASH·NOTI}.**
  Mỗi ô = **(a)** 1 assertion int-spec ĐANG CHẠY (file + tên `it()` thật), **hoặc (b)** N/A có lý do.
  - **System scope = N/A toàn cột** (N=1 đơn-công-ty; super-admin KHÔNG phải data-scope per-module — §14.2
    "chỉ nếu MVP bật multi-company/system scope"). Ghi lý do 1 lần.
  - Ô còn TRỐNG sau khi quét cả 2 glob → **thành gap-test mới** (§3.3), KHÔNG im lặng bỏ. Ứng viên nghi
    mỏng cần verify khi dựng bảng: Department×{ATT,LEAVE} (role mặc định không có Dept-scope; nếu chỉ có
    `data-scope-resolver` generic predicate thì cân nhắc 1 test HTTP module-specific hoặc justify N/A) ·
    Team×TASK (TASK dùng scope **Project**, không Team — có thể N/A + trỏ Project-scope spec).
- **Bảng B — Checklist §14.3 (13 mục)** → spec phủ (cite file + `it()`); #12 = FE (ngoài phạm vi API).
- **Bảng C — NEG-PERM-001..006** → spec phủ, **cite file cụ thể** (reviewer: 002/003/006 phải cite, không
  chỉ "COVERED"): 001→`leave-approval.int.spec.ts:352` · 002→`leave-qa2-api.int-spec.ts:341`+`employees-scope-int2:241` ·
  003→`admin-users-deny.int-spec.ts:248` · 004→**G1 (mới)** · 005→D3 (documented) · 006→`employee-file.int-spec.ts`+`task-files-access`.

Kèm alias script gom nhóm spec perm/scope để re-run (suite tái dùng máy-đọc).

### 3.2 QA-SEC-001 — báo cáo security testing
`docs/_review/S5-SEC-1-SECURITY-TESTING-2026-07-25.md`: trạng thái QA-06 (§11.1–11.12, cite spec) + OWASP
API Top 10 (§12) + **export = COVERED** (D2, KHÔNG ghi N/A) + phân tích mitigation rate-limit/refresh/reset
(D1) + **mục ACCEPTED-RISK riêng cho D3** (owner ký) + trạng thái 3 bất biến + rủi ro tồn dư + kết luận
sẵn-sàng-UAT (gate WS-E).

### 3.3 Gap tests (RED-first)
| # | Sev | File | Nội dung | Trạng thái |
| --- | --- | --- | --- | --- |
| **G1** | HIGH | **`test/integration/noti-deeplink-perm-lost.int-spec.ts`** (mới) | NEG-PERM-004/§14.3-#9. Seed notification cho recipient (INSERT trực tiếp: `company_id,user_id,recipient_user_id,type,notification_type,module_code,event_code,status,priority,title,short_body,body,target_url`) với `target_url` trỏ route module nguồn. **Cấp rồi REVOKE** quyền đọc module nguồn. Assert: (a) notification vẫn list/đọc được (own-scope, không mất); (b) GET `target_url` → **403** (module guard chặn dù deep-link); (c) body không rò field record nguồn (`assertNoSecrets`). | **GENUINE — bắt buộc** |
| **G2** | LOW | **`test/integration/auth-rate-limit-http.int-spec.ts`** (mới, tuỳ chọn) | Tầng HTTP (supertest): N×`POST /auth/login` sai → **429 status thật** qua exception filter (hiện chỉ có service-level `auth.int-spec.ts:182`). Tất định (in-memory limiter / reset namespace, không phụ thuộc Valkey). | Nhỏ, bổ khuyết HTTP-vs-service |
| Gx | — | (phát sinh) | Mỗi ô TRỐNG trong Bảng A §3.1 → 1 test HTTP module-specific theo idiom `employees-rbac-scope`. | Chỉ khi Bảng A lộ ô trống |

> Route deep-link G1: chọn route read-guard sạch + object own-scope — verify guard bằng grep controller
> TRƯỚC khi assert (ứng viên: LEAVE `GET /leave/requests/:id`? — thực tế là `/leave/me/requests/:id` own +
> `/leave/requests` list view-scope; hoặc TASK `GET /tasks/:id`). Chốt route ở bước implement sau khi grep.

---

## 4. Thứ tự thực thi

1. **Dựng Bảng A (ma trận §14.2)** quét CẢ HAI glob → phát hiện ô trống thật (nếu có) → chốt danh sách gap
   cuối (G1 + Gx nếu có). **Escalation:** nếu 1 ô lộ ra **thiếu enforcement THẬT ở `src`** (không phải chỉ
   thiếu test) → **KHÔNG tự sửa `src` ở WO này** (out-of-scope §7) và **KHÔNG đánh N/A im lặng** → mở WO mới
   (ghi CRITICAL vào QA-SEC-001 + báo người).
2. **RED-first cho G1** (+ Gx/G2 nếu có): viết assertion; với hành vi đúng hiện có test PASS ngay. Để chứng
   minh test có ý nghĩa (không pass-giả): **RED-demo = nới CỤC BỘ trong arrange-block của CHÍNH test**
   (vd bỏ bước revoke), chạy thấy ĐỎ, **capture output vào evidence, RỒI HOÀN NGUYÊN — TUYỆT ĐỐI KHÔNG
   COMMIT bản đã nới**. **CẤM** sửa `src/`, guard, seed, helper chung để tạo RED (bài học
   `plan-review-rounds-inject-new-holes`).
3. GREEN toàn bộ trên `mediaos_sec1`.
4. Viết QA-PERM-001 (3 bảng, cite spec thật) + QA-SEC-001 từ kết quả THẬT.
5. FULL gate: `security-reviewer` + `silent-failure-hunter` + `rls-tenant-isolation-tester` trên diff.
6. `bash harness/check.sh --lane-db=sec1` → xanh trước PR.

**Lệnh chạy an toàn (KHÔNG chạm PROD `mediaos`):**
```bash
bash scripts/lane-db-setup.sh sec1            # tạo + chain-migrate mediaos_sec1
DATABASE_URL="postgres://mediaos_app:${APP_DB_PASSWORD}@localhost:5432/mediaos_sec1" \
DATABASE_DIRECT_URL="postgres://mediaos:${SUPERUSER_DB_PASSWORD}@localhost:5432/mediaos_sec1" \
DATABASE_WORKER_URL="postgres://mediaos_worker:${WORKER_DB_PASSWORD}@localhost:5432/mediaos_sec1" \
LANE_DB=mediaos_sec1 \
  pnpm --filter @mediaos/api test -- test/integration/noti-deeplink-perm-lost.int-spec.ts
```
> **Belt defense-in-depth (reviewer):** mỗi spec MỚI thêm trong `beforeAll` một guard
> `if (/(^|\/)mediaos$/.test(new URL(directUrl).pathname)) throw new Error("refuse PROD mediaos")` —
> chặn cứng dù `.env` ghim `mediaos`. `hasDb && LANE_DB` vẫn là điều kiện chạy; thiếu → SKIP.

---

## 5. Traceability done_when → deliverable

| done_when | Deliverable |
| --- | --- |
| #1 Ma trận Own/Team/Dept/Company/System × mọi module + negative §14.4 | QA-PERM-001 Bảng A (§14.2 đủ 5×7, System=N/A justified) + Bảng C (NEG-PERM, G1 bịt 004) — chạy trên lane DB làm bằng chứng |
| #2 Field/export perm không lộ lương/PII (list/export/log/noti/dashboard cache) + IDOR/file/rate-limit | QA-PERM-001 Bảng B (#6 salary, #7 widget-source) + D2 export COVERED (cite 2 export int-spec) + IDOR(me-qa1)/file(employee-file,file-security)/rate-limit(G2 + login-rate-limiter) |
| #3 Suite tái dùng (QA-PERM-001) + báo cáo security (QA-SEC-001) trong docs/_review + 3 bất biến | QA-PERM-001 + QA-SEC-001 + §6 bất biến không suy yếu |
| #4 FULL gate + plan-reviewer PASS | plan-reviewer PASS (v2) → FULL gate 3 reviewer trên diff |

---

## 6. Tác động bất biến & rủi ro

**Bất biến:** KHÔNG migration/grant/đụng `src` → #1 RLS, #2 append-only, #3 no-secret không suy yếu; test
mới chỉ **củng cố** bằng chứng. Fixture secret = ghép-chuỗi (né gitleaks generic-api-key).

| Rủi ro | Giảm thiểu |
| --- | --- |
| Chạy nhầm PROD `mediaos` | `DATABASE_*` tường minh + `LANE_DB` + belt-throw trong beforeAll. |
| RED-demo nới bị commit nhầm | Nới CHỈ trong arrange-block; capture đỏ → hoàn nguyên; không commit; reviewer soi diff. |
| Bảng A lộ ô Dept/Team trống bất ngờ | Coi là gap thật → thêm Gx HTTP-scoped; KHÔNG đánh N/A vô căn cứ. |
| Flake rate-limit (G2) | in-memory limiter / reset namespace, không phụ thuộc Valkey chung. |
| Route deep-link G1 chọn sai | grep guard controller + object own-scope TRƯỚC khi assert. |

## 7. Ngoài phạm vi
Test FE UI-state/a11y (→ S5-QA-REG-1) · performance/load (QA-07) · endpoint export MỚI · throttle mới
refresh/reset (D1) · sửa `src` sản phẩm · migration/permission-seed.

> _S6-SEC-ROTATE-1 (KI-043) 2026-07-28: mật khẩu trong khối lệnh trên đã được thay bằng biến env. Literal gốc là mật khẩu THẬT của cụm PROD (repo PUBLIC) — đã rotate và gỡ khỏi mọi file tracked._
