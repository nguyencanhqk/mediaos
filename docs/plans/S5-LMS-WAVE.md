# S5-LMS-WAVE — Tích hợp LMS Giai đoạn B (kế hoạch wave)

> Trạng thái: SEEDED 2026-07-21 · Chủ wave: owner · Nguồn: quyết định owner 2026-07-21 (chọn cả 5 hạng mục).
> Review đối kháng plan-reviewer 2026-07-21: **PASS-with-fixes** — 2 must-fix + 5 warning ĐÃ VÁ trong bản này
> (event LMS-sync tách khỏi auth.user_locked · guard break-glass ADMIN_EMAILS · serial hoá track LOCAL vào
> depends_on · payload thêm name · va số migration với S5-GOAL-DB-2 · blast-radius token progress · scope BE-2).
> Đây là kế hoạch Ô (umbrella). Mỗi WO đỏ vẫn phải có micro-plan riêng `docs/plans/<id>.md`
> (planner Sonnet+xhigh → plan-reviewer đối kháng) TRƯỚC khi code — theo CLAUDE.md §6.

---

## 1. Bối cảnh — Giai đoạn A đã LIVE (không làm lại)

- Cầu SSO một chiều MediaOS→LMS: `GET /api/v1/integrations/lms/sso-link` (HMAC-SHA256, TTL 60s,
  jti một-lần, bảng `sso_consumed_tokens` chống replay phía LMS) — PR #253, merged `bc09ffb7`.
- Quyền `access:lms` (non-sensitive) seed 4 role canonical + gate BE (`@RequirePermission`) +
  FE (APP_REGISTRY card + sidebar `me.lms` + route `/lms`) — PR #254, merged `bd981f8c`, mig `0508`.
- LMS chạy local `apps/lms` (Next.js 15 + SQLite, **NGOÀI git MediaOS** — gitignore vì repo public),
  NSSM service `MediaOS-LMS` port 3400 → `train.funtimemediacorp.com` qua cloudflared.
- Script đồng bộ tay `apps/api/sync-lms-users.mjs` (active→tạo/mở khoá; nghỉ→khoá bền `disabled_at` và
  thu hồi phiên) gọi `POST {LMS}/api/admin/sync-users` Bearer `MEDIAOS_SYNC_TOKEN`.
- Nợ security review #253 (MEDIUM): audit log hành động mint/consume SSO.

## 2. Phạm vi Giai đoạn B (owner chốt 2026-07-21 — đủ 5 hạng mục)

1. **Đồng bộ tài khoản TỰ ĐỘNG** — hết chạy tay: HR cho nghỉ/khoá → LMS khoá theo, nhân viên mới → có tài khoản.
2. **SSO-only** — khoá đăng nhập trực tiếp LMS (login mật khẩu/register/quên-mật-khẩu) cho user công ty; vào LMS CHỈ qua nút Đào tạo trong MediaOS. Giữ break-glass cho quản trị.
3. **Trả nợ audit SSO** — audit_logs cho mint (MediaOS) + consume (LMS, ghi `admin_audit_log` sẵn có).
4. **Dữ liệu đào tạo chảy ngược** — tiến độ khoá học/điểm thi hiển thị trong `/me` MediaOS.
5. **Chuẩn hoá giao diện LMS** — bỏ landing `/`, chưa đăng nhập → auth, `/course` = giao diện chính, sắp lại sidebar/admin cho chuẩn chỉnh.

**Ngoài phạm vi wave (ghi nhận, KHÔNG làm):** báo cáo đào tạo cấp phòng/công ty cho HR·dashboard widget đội nhóm; map role MediaOS→role LMS (instructor…); đồng bộ 2 chiều; gỡ các khu chat/AI/call của LMS (chỉ ẨN nav nếu tiện, không xoá code).

## 3. Hai track thi công — ràng buộc QUAN TRỌNG

| Track | Code | Đường ship | Lưu ý |
| --- | --- | --- | --- |
| **PR** (MediaOS) | `apps/api` · `apps/app` · `packages/*` | WO thường: nhánh → PR → gate → merge | như mọi wave |
| **LOCAL** (LMS) | `apps/lms/**` (ngoài git) | sửa tại chỗ → review agent local → build → NSSM restart `MediaOS-LMS` | **KHÔNG có PR/worktree/CI** — worktree KHÔNG chứa apps/lms ⇒ WO APP-* phải chạy Ở MAIN worktree, TUẦN TỰ (không fan-out song song 2 WO APP) |

Kỷ luật track LOCAL (thay cho gate CI):
- **Backup `apps/lms/data/app.db` TRƯỚC mỗi đợt deploy** (copy file cạnh đó, đặt tên theo ngày). DB SQLite live, 34+ user thật.
- Review vẫn chạy: WO đỏ = security-reviewer + silent-failure-hunter đọc diff local; WO vàng = typescript-reviewer.
- Verify sau restart: curl smoke `/login` 200, `/api/auth/sso` sai chữ ký → 401, đăng nhập SSO end-to-end từ MediaOS.
- Secret (`MEDIAOS_SSO_SECRET`, `MEDIAOS_SYNC_TOKEN`, `LMS_SYNC_TOKEN`) chỉ nằm trong `.env*` — CẤM vào docs/commit/log (repo MediaOS public).

## 4. Kiến trúc & quyết định wave (LMS-DEC-B*)

- **B01 — Auto-sync = event + đối soát (2 lớp).** (a) Outbox event **RIÊNG** `hr.employee_status_changed`
  payload whitelist `{email, name?, active}` — enqueue TRONG tx tại `HrWriteService.changeStatus`
  (OutboxService đã inject sẵn; row là employee_profiles KHÔNG có email → resolve qua users theo userId,
  `userId==null` thì bỏ qua; `active` tính như script: user active AND profile active) VÀ tại đường admin
  khoá/mở user (`auth-users.service.ts:274-333` — thêm inject OutboxService, additive vì EventsModule
  @Global). **CẤM re-emit `auth.user_locked`** (plan-review #1): event đó đã có consumer notification
  AUTH_USER_LOCKED và chỉ phát từ auto-lock sai-mật-khẩu — dùng lại sẽ đổi hành vi crown-auth và làm
  auto-lock tạm thời lan sang khoá LMS. Consumer `LmsUserSyncBridge` (EventBus, trong `integrations/lms`,
  TÁCH HẲN pipeline notification) → `POST {LMS}/api/admin/sync-users` 1 user, idempotent; khi LMS lỗi tạm
  consumer PHẢI throw để outbox-worker retry ×5 → dead-letter có alert (KHÔNG catch rỗng).
  (b) Job đối soát `@SystemJobHandler` jobCode `LMS_USER_SYNC` (mẫu `task-reminder.job-handler.ts`)
  chạy định kỳ quét toàn bộ user+employee_profiles (đúng query của `sync-lms-users.mjs`, mang `name` —
  đường TẠO tài khoản mới đi qua job/JIT, event chỉ khoá/mở tài khoản đã tồn tại) — tự lành mọi drift
  (event rớt, LMS down lúc phát). Script tay GIỮ làm fallback.
- **B02 — Env chuẩn hoá:** thêm `LMS_SYNC_TOKEN` vào `env.schema.ts` (cạnh `LMS_SSO_SECRET:208`,
  min 32, optional — thiếu thì bridge/job tắt + log warn 1 lần, KHÔNG chặn boot; mirror posture SSO 503).
  Giá trị = trùng `MEDIAOS_SYNC_TOKEN` phía LMS. Script tay đọc cả 2 tên (tương thích ngược).
- **B03 — Audit:** migration `0509` (kiểm lại `_journal.json` trước khi đánh số) UNION-ADD 2 object_type
  `'lms_sso'` + `'lms_sync'` vào CHECK `audit_logs_object_type_chk` (DO-block idempotent mẫu 0491/0474)
  và cập nhật `AUDIT_OBJECT_TYPES` trong `db/schema/audit.ts` CÙNG commit. Mint ghi audit
  `lms_sso`/`sso_link_minted` (objectId=jti, KHÔNG log token). Sync ghi `lms_sync` (summary số lượng,
  KHÔNG dump danh sách email vào payload). Consume phía LMS → `admin_audit_log` (bảng sẵn có).
- **B04 — SSO-only qua cờ env LMS `SSO_ONLY=true`** (đọc qua `lib/platform/env.ts`):
  route `/register`·`/forgot-password` redirect `/login`; API `sign-up`/`forgot-password`/`reset-password`/
  `resend-otp` → 403; `/login` ẩn form mật khẩu, hiện 1 nút "Đăng nhập qua MediaOS" → `{MEDIAOS_APP_URL}/lms`;
  **break-glass**: email thuộc `ADMIN_EMAILS` vẫn login mật khẩu (form sau toggle "Đăng nhập quản trị") —
  chống tự khoá cửa khi MediaOS/SSO sự cố. Đổi mật khẩu trong app cũng chặn khi SSO_ONLY (trừ break-glass).
  **GUARD bắt buộc** (plan-review #2): `SSO_ONLY=true && ADMIN_EMAILS rỗng` → từ chối bật (fail-loud) —
  `isEnvOwnerEmail` trả false khi ADMIN_EMAILS chưa set ⇒ không guard = khoá cửa toàn bộ admin.
  **Verify JIT trước khi bật**: route consume `/api/auth/sso` phải gọi `ensureUserForSso` (JIT) để nhân
  viên MỚI chưa từng vào LMS không bị khoá ngoài dưới SSO_ONLY — thiếu thì bổ sung trong APP-2.
- **B05 — `/course` = giao diện chính:** `/` hết là landing — server redirect: có phiên → `/course`,
  chưa → `/login`; SSO default `next=/course`; sau login → `/course`. `/dashboard` (My Learning) GIỮ,
  relabel "Khoá học của tôi" trong nav. Sidebar sắp lại: Course lên đầu; **ẨN khu HR placeholder**
  (employee/attendance/salary/benefits/uniform/assets/performance — MediaOS đã lo các mảng này);
  admin giữ Users/Roles/General/RAG theo permission như cũ.
- **B06 — Tiến độ chảy ngược = proxy đọc-thẳng, KHÔNG lưu DB MediaOS.** LMS thêm
  `GET /api/mediaos/progress?email=<e>` Bearer `MEDIAOS_SYNC_TOKEN` (tái dùng `bearerMatches` của
  sync-users): enrollment + %/course (SQL sẵn ở `app/(app)/dashboard/page.tsx:28-53`) + learning time
  và điểm quiz/exam. MediaOS BE `GET /me/training`: email resolve TỪ TOKEN (không nhận param — mirror
  SPEC-09 §14.4), gọi LMS, cache ngắn ~60s, gate `access:lms`. FE: card "Đào tạo" trong `/me` +
  trang `/me/training`. Không bảng mới, không migration — muốn báo cáo HR thì wave sau sync vào DB.
  Blast-radius token (plan-review W4): `MEDIAOS_SYNC_TOKEN` là token quyền-cao (khoá/mở/tạo tài khoản) —
  micro-plan APP-3 chốt dùng-chung vs token-đọc-riêng; tối thiểu endpoint progress PHẢI có rate-limit per-IP.

## 5. Work Order (8 WO — seed trong `harness/backlog.mjs`)

| # | WO | Track | Zone | Tóm tắt | depends_on |
| --- | --- | --- | --- | --- | --- |
| 1 | S5-LMS-DB-1 | PR | đỏ | Mig 0509 UNION-ADD audit `lms_sso`+`lms_sync` + union TS | — |
| 2 | S5-LMS-BE-1 | PR | đỏ | Auto-sync: event `hr.employee_status_changed` + bridge + job `LMS_USER_SYNC` + env `LMS_SYNC_TOKEN` + audit `lms_sync` | DB-1 |
| 3 | S5-LMS-BE-2 | PR | đỏ | Audit mint SSO (`lms_sso`) — trả nợ #253 | DB-1 |
| 4 | S5-LMS-APP-1 | LOCAL | vàng | UI chuẩn hoá: bỏ landing, `/course` chính, sidebar/nav tidy | — |
| 5 | S5-LMS-APP-2 | LOCAL | đỏ | SSO-only (cờ `SSO_ONLY` + break-glass + guard) + audit consume | BE-1 · APP-3 |
| 6 | S5-LMS-APP-3 | LOCAL | đỏ | API export tiến độ `GET /api/mediaos/progress` | APP-1 |
| 7 | S5-LMS-BE-3 | PR | đỏ | Proxy `GET /me/training` (+contracts) gọi LMS | APP-3 |
| 8 | S5-LMS-FE-1 | PR | vàng | `/me` card Đào tạo + trang `/me/training` | BE-3 |

**Thứ tự đề xuất:** DB-1 → BE-1 ‖ APP-1 (quick-win nhìn thấy ngay) → BE-2 ‖ APP-3 → BE-3 → FE-1 →
**APP-2 CUỐI CÙNG** (chỉ khoá cửa khi: Pages đã deploy bản mới, auto-sync chạy ổn, nhân viên đã quen vào qua MediaOS).
Track LOCAL đã SERIAL HOÁ vào `depends_on` máy-đọc (APP-1 → APP-3 → APP-2 — plan-review W2): chuỗi này là
ràng buộc chống-song-song trên cùng `apps/lms` (main worktree, không worktree-isolation), KHÔNG phải phụ thuộc logic.

## 6. Checklist vận hành (OWNER chạy tay — classifier chặn agent)

Trước/kèm wave — các lệnh chi tiết nằm trong memory phiên trước:

- [ ] **Deploy `apps/app` lên Pages** (mang card+gate #254 ra PROD) — script `06-deploy-pages.ps1 -Apps app`.
- [ ] **Chạy `sync-lms-users.mjs` (bỏ --dry-run)** khoá 11 người đã nghỉ trên LMS — sau này job LMS_USER_SYNC thay thế.
- [ ] Thêm `LMS_SYNC_TOKEN` vào `.env` + `.env.prod` MediaOS-API (giá trị = `MEDIAOS_SYNC_TOKEN` phía LMS) — cần trước khi BE-1 lên PROD.
- [ ] **TRƯỚC khi flip cờ APP-2 (BẮT BUỘC — plan-review #2):** `ADMIN_EMAILS` trong `apps/lms/.env.production` đã trỏ tới email admin THẬT + đã test đăng nhập mật khẩu break-glass thành công trên PROD.
- [ ] Thêm `SSO_ONLY=true` + `MEDIAOS_APP_URL` vào `apps/lms/.env.production` — CHỈ khi bật APP-2, SAU khi mục trên xanh.
- [ ] Backup `apps/lms/data/app.db` trước mỗi lần restart `MediaOS-LMS`.

## 7. Rủi ro & bẫy đã biết

- **`apps/lms` ngoài git** → không diff/PR/rollback bằng git. Giảm rủi ro: backup app.db + giữ bản copy thư mục trước sửa lớn; cân nhắc (tuỳ owner) init git LOCAL riêng trong `apps/lms` (không remote) để có diff/rollback — KHÔNG push đi đâu.
- **Khoá nhầm chính mình (APP-2):** bắt buộc break-glass `ADMIN_EMAILS` + test đăng nhập quản trị TRƯỚC khi bật cờ trên PROD.
- **Outbox event mới đụng `HrWriteService` (crown HR):** enqueue phải CÙNG tx, payload whitelist (email, active — không kéo nguyên row nhân sự); memory `noti-outbox-bridge-generic` — bridge LMS là consumer EventBus THƯỜNG, KHÔNG đi qua OutboxNotificationBridge (cái đó dành cho notification, fail-loud theo NOTI catalog).
- **Job per-tenant:** `JobRunContext` chỉ có `companyId` — job LMS_USER_SYNC chạy mọi tenant nhưng chỉ company có employee_profiles khớp LMS (funtime) có tác dụng; company khác trả total=0, không lỗi.
- **PROD Postgres lệch migration** (memory `prod-3-way-drift`): 0509 lên PROD theo đường phẫu thuật psql như 0508 nếu owner chưa full-migrate.
- **Secret trong repo public:** mọi ví dụ trong plan/spec dùng tên biến, KHÔNG giá trị; fixture test ghép chuỗi (luật gitleaks CLAUDE.md §5).
- **LMS down khi mint/consume:** bridge/job phải fail-soft (log + retry), không kéo sập luồng HR (khoá nhân viên phía MediaOS PHẢI thành công kể cả LMS chết — sync bù sau).

## 8. Definition of Done cấp wave

Nhân viên mới vào công ty → tự có tài khoản LMS; nghỉ việc → LMS khoá + thu hồi phiên trong ≤1 chu kỳ job mà không ai chạy tay. Toàn bộ đăng nhập LMS của user công ty đi qua nút Đào tạo MediaOS; register/forgot-password đóng; break-glass hoạt động. Mint/consume SSO + sync có vết audit 2 phía. `/me` MediaOS hiển thị tiến độ học thật từ LMS. `train.funtimemediacorp.com` mở ra là `/course` (hoặc `/login` khi chưa có phiên), không còn landing marketing, sidebar không còn khu HR placeholder.
