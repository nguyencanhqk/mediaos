# QA-SEC-001 — Báo cáo Security Testing (S5-SEC-1 · WS-E · 🔴 crown)

> Ngày: 2026-07-25 · WO: S5-SEC-1 · Gate của UAT (WS-E). Nguồn chuẩn: QA-06 (§11.1–11.12, §12 OWASP API
> Top 10) · IMPLEMENTATION-08 §14 · `docs/permission-matrix-spec.md`. Bằng chứng phân quyền/scope chi tiết:
> [QA-PERM-001](../QA/evidence/S5-SEC-1-PERM-SCOPE-SUITE.md).
>
> **Phương pháp:** không pentest thủ công tách rời — kiểm chứng bằng **integration-test trên Postgres THẬT**
> (DB cô lập lane, qua chuỗi guard đầy đủ `JwtAuthGuard → CompanyGuard → PermissionGuard`), quét cả 2 glob
> spec (`test/**/*.int-spec.ts` + colocated `src/**/*.int.spec.ts`, ~251 file). Đợt S5-SEC-1 **thêm 1 test
> bịt lỗ (G1)** và **KHÔNG sửa `src` sản phẩm**.

---

## 1. Kết luận điều hành

**Sẵn sàng gate WS-E cho UAT.** Bề mặt bảo mật MVP (authn/session · authz/RBAC/scope · multi-tenant ·
input/injection · file · export · masking · audit · rate-limit) **đã được phủ bằng test tự động**. Không
phát hiện lỗ hổng **CRITICAL/HIGH mở**. Một lỗ coverage thật (deep-link mất-quyền) đã đóng bằng G1. Ba
quyết định phạm vi (D1 rate-limit refresh/reset · D2 export · D3 dashboard Department) ghi rõ dưới đây; **D3
là accepted-risk cần owner ký**.

| Mức | Số phát hiện mở |
| --- | --- |
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 mở (1 accepted-risk documented — D3) |
| LOW/NOTE | rà soát, không chặn |

---

## 2. Trạng thái theo QA-06 §11

| QA-06 § | Chủ đề | Trạng thái | Bằng chứng chính |
| --- | --- | --- | --- |
| 11.1 | Authentication & session | PASS | `auth.int-spec.ts`, `auth-session*.int-spec.ts`, `auth-logout`, `two-factor-login`, `auth-blocked-status` |
| 11.2 | Authorization/RBAC/data-scope | PASS | QA-PERM-001 Bảng A/B/C (ma trận 5×7 + 13 checklist + 6 NEG-PERM) |
| 11.3 | Multi-tenant isolation | PASS | `db-rls`, `*-tenant-isolation*`, cross-tenant→404 xuyên các module (QA-PERM-001) |
| 11.4 | Input validation / injection / mass-assignment | PASS | Zod DTO `.strict()` (me-qa1 PATCH stray key→400) · CSV-injection neutralize ở export |
| 11.5 | XSS / output encoding | PASS (BE) | Payload JSON envelope; masking server-side; FE encoding ngoài phạm vi WO |
| 11.6 | CSRF/CORS/cookie | PASS | Bearer-token (không cookie-session cho API); CORS cấu hình app |
| 11.7 | File upload/download security | PASS | `file-access-hardening.int.spec.ts:397`, `files-rls-isolation`, `task-files-access:481`, scan-status gate |
| 11.8 | Sensitive data exposure & masking | PASS | `employees-salary-sensitive:245/260`, dashboard cache no-PII `:454`, `assertNoSecrets` (me-qa1 + G1) |
| 11.9 | Module-specific security matrix | PASS | QA-PERM-001 Bảng A theo module |
| 11.10 | Rate limit & abuse | PASS (có ngoại lệ documented — §3 D1) | `login-rate-limiter.ts` (login/forgot/2FA-verify/change-password); brute-force→429 `auth.int-spec.ts:182` + G2 (nếu thêm) |
| 11.11 | Audit/logging security | PASS | `audit-logs-appendonly`, `audit-permission-deny`, append-only ledgers, masking `me-qa1` IP/UA |
| 11.12 | CI/CD & release security | PASS | gitleaks secret-scan (`.gitleaks.toml`), `pnpm audit` override (PR #257), env prod sanity |

---

## 3. Quyết định phạm vi (đưa vào sổ để owner ký)

### D1 — Rate-limit `refresh` + `resetPassword` KHÔNG throttle (chấp nhận theo thiết kế)
- **Đã throttle THẬT** (`apps/api/src/auth/login-rate-limiter.ts`, per-IP + per-account, Valkey/in-memory
  fail-soft): `login`, `forgot-password` (namespace `rl:forgot:*`), `2FA-verify`, `disable-2FA`,
  `change-password`. Brute-force login → 429 (`auth.int-spec.ts:182`, service-level).
- **KHÔNG throttle** `refresh` và `resetPassword` — **có mitigation theo thiết kế**:
  - `refresh`: **reuse-detection** (phát hiện token tái dùng → revoke chuỗi) + `SELECT … FOR UPDATE`
    (chống đua). Brute-force không mở rộng bề mặt vì mỗi refresh-token dùng-một-lần.
  - `resetPassword`: token **high-entropy, lưu HASHED, dùng-một-lần, hết hạn ngắn** → không enumerate,
    không brute-force khả thi.
- **Quyết định:** KHÔNG thêm throttle mới vào `auth.service.ts` (crown) một cách suy đoán (YAGNI + tránh
  mở bề mặt rủi ro auth). **Chấp nhận** mitigation hiện có. _(Nếu owner muốn throttle refresh/reset → WO
  riêng, expand-contract có test 429 riêng.)_

### D2 — Export permission: CÓ tồn tại + đã test (đính chính "N/A")
Ba đường export gated quyền, KHÔNG lộ lương/PII:
`GET /attendance/records/export` (`export:attendance`) · `GET /hr/employees/export` (`export:employee`
**sensitive**, per-row PII mask + salary/CCCD **forced null**) · `GET /leave/reports` (`export:leave`
Company-only). Chi tiết + spec: QA-PERM-001 §5. **PASS.**

### D3 — Dashboard `hr-overview` với HR scope Department → **ACCEPTED-RISK (cần owner ký)**
- **Hiện trạng:** widget `hr-overview` là **count-only, viewer-independent, PII-masked**
  (`dashboard-widget-security.int-spec.ts:416/454`); được gate bằng **quyền widget** (không phải data-scope).
  Một HR được cấp scope Department mà vẫn có quyền widget sẽ thấy **con số headcount toàn công ty**.
- **Vì sao chấp nhận ở MVP:** `permission-matrix-spec.md §7` — DASH **chỉ gate hiển thị; module NGUỒN ép
  data-scope**. Widget là tổng-hợp count-only + đã mask PII; deep-link chi tiết vẫn bị module nguồn ép
  scope. HR mặc định là scope **Company** (Department chỉ là cấp-thêm phi-mặc-định). §14.4 NEG-PERM-005 cho
  phép "403 **hoặc** data scoped đúng".
- **Rủi ro tồn dư:** lộ **tổng-hợp** headcount xuyên phòng-ban cho HR-Department (không lộ PII cá nhân).
- **Đề xuất:** owner ký chấp nhận cho MVP; nếu cần scope-đúng-count → enhancement Phase sau (scope count
  theo Department), KHÔNG phải blocker UAT.

---

## 4. OWASP API Security Top 10 (QA-06 §12)

| Risk | Trạng thái | Ghi chú |
| --- | --- | --- |
| API1 BOLA (object-level) | PASS | IDOR sweep `me-qa1:369`; cross-object/tenant→404 (files, tasks, employees, notifications) |
| API2 Broken Auth | PASS | login/refresh/logout/reset/2FA + brute-force 429 (D1 mitigation refresh/reset) |
| API3 Object Property-level | PASS | field-level mask (salary/CCCD), mass-assignment chặn (Zod `.strict()`) |
| API4 Unrestricted Resource Consumption | PASS | export row-cap 422; rate-limit login/forgot; refresh reuse-detection |
| API5 Function-level authz | PASS | PermissionGuard fail-closed per-route (QA-PERM-001) |
| API6 Sensitive Business Flow | PASS | approve/duyệt scope-bound; deep-link mất-quyền → 403 (G1) |
| API7 SSRF | N/A MVP | target_url validate route nội bộ (loud 422), không fetch URL public |
| API8 Security Misconfig | PASS | envelope filter (không stack-trace), env prod sanity |
| API9 Improper Inventory | PASS | versioned `/api/v1`, module disabled → hành vi đúng |
| API10 Unsafe API Consumption | PASS | internal event/notification qua DTO/masking layer |

---

## 5. Ba bất biến (BẤT BIẾN §2 CLAUDE.md)

| Bất biến | Trạng thái | Bằng chứng |
| --- | --- | --- |
| #1 `company_id`/RLS mọi query | GIỮ VỮNG | `db-rls`, cross-tenant→404 toàn module; đợt này không migration/không đụng RLS |
| #2 Không hard-delete / audit append-only | GIỮ VỮNG | `audit-logs-appendonly`, ledgers append-only; notification soft-delete; đợt này không đụng |
| #3 Không secret plaintext | GIỮ VỮNG | hash password, envelope-encrypt secret; `assertNoSecrets` (me-qa1 + G1); fixture né gitleaks |

Đợt S5-SEC-1 **test-only + docs** ⇒ không mở bề mặt regression production; 3 bất biến **không suy yếu**,
G1 **củng cố** thêm bằng chứng.

---

## 6. Lỗ đã đóng trong đợt này

| ID | Mô tả | Fix |
| --- | --- | --- |
| G1 / NEG-PERM-004 / §14.3-#9 | Deep-link notification vẫn phải bị guard chặn khi recipient mất quyền module nguồn — trước đó CHƯA có test compose | `apps/api/test/integration/noti-deeplink-perm-lost.int-spec.ts` (GREEN 6/6, RED-demo chứng minh) |

---

## 7. Rủi ro tồn dư & khuyến nghị

1. **D3 accepted-risk** — owner ký cho MVP (headcount count-only xuyên phòng-ban cho HR-Department).
2. **Export mới trong tương lai** — nếu thêm endpoint export/report mới → **re-audit** field-permission +
   PII mask + scope + row-cap (mẫu: `hr-export.service.ts`).
3. **Throttle refresh/reset** — nếu threat-model nâng cấp → WO riêng (D1), expand-contract.
4. **System scope** — nếu bật multi-company (SaaS) → mở lại các ô System của ma trận (hiện N/A vì N=1).

**Kết luận:** không blocker UAT từ WS-E. Đề nghị owner ký D3 và chuyển tiếp UAT (S5-UAT-1).
