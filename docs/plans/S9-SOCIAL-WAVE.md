# Kế hoạch wave S9-SOCIAL — nhập `fbpost` thành app vệ tinh "Đăng bài mạng xã hội"

> **Loại:** kế hoạch cấp WAVE. Plan chi tiết từng WO nằm ở `docs/plans/S9-SOCIAL-<WO>.md`, viết ngay trước khi thi công WO đó.
> **Ngày lập:** 06/08/2026 · **Trạng thái:** **CHỜ OWNER KÝ** (`S9-SOCIAL-DOC-1` chặn toàn bộ WO còn lại).
> **Yêu cầu gốc (owner, 06/08/2026):** "repo vừa xây ở `C:\fbpost` — thêm vào hệ thống thành một ứng dụng mới". Owner chọn **hướng A — app vệ tinh, sao khuôn LMS** (06/08/2026).
> **Nguồn sự thật tiền lệ:** [apps/lms](../../apps/lms/) + wave `S5-LMS-*` (`docs/plans/S5-LMS-*.md`) — cùng mô hình app Next.js nhập tại chỗ, nối hệ bằng cầu SSO + tile app + kênh NOTI.

---

## 1. Điểm xuất phát — ĐO THẬT ngày 06/08/2026 tại `C:\fbpost`

| Sự việc | Bằng chứng |
| --- | --- |
| Stack | Next.js 15.5 App Router + React 19.1 + Tailwind v4 + Zod 4 + TypeScript 5.9 (`package.json`) |
| Quy mô | 65 file trong `src/` — **21** route handler `src/app/api/**/route.ts`, 7 trang, 7 repository, 12 file `src/lib/fb/**` |
| Lưu trữ | SQLite qua **`node:sqlite`** (built-in Node 22+, KHÔNG native module) — file `data/fbpost.db`; upload để ở `data/uploads/` |
| Bảng | 7: `settings` · `media` · `accounts` · `pages` · `contents` · `plans` · `posts` (`src/lib/db.ts`) |
| Hẹn giờ | worker **in-process**, `setInterval` 60s, khởi động từ route handler (`src/lib/worker-boot.ts` — cố ý KHÔNG dùng `instrumentation.ts` vì edge runtime không có `node:fs`) |
| Quyền Facebook | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` (`src/lib/fb/constants.ts`) |
| Git | **KHÔNG có `.git`** — repo chưa từng được khởi tạo |
| `.gitignore` | đã loại `node_modules/`, `.next/`, **`data/`**, `.env` — phần này làm đúng |

### 1.1 Bốn điểm va chạm với hợp đồng MediaOS

| # | Va chạm | Bằng chứng | Hệ quả |
| --- | --- | --- | --- |
| 1 | **Secret plaintext — BẤT BIẾN #3** | `accounts.app_secret`, `accounts.user_token`, `pages.access_token` đều `TEXT` thô trong SQLite (`src/lib/db.ts:26-49`) | Trên máy cá nhân thì chấp nhận được; **đưa lên server công ty là vi phạm**. Đây đúng ca "credential bên thứ ba" mà CLAUDE.md §2 đòi envelope-encryption/KMS |
| 2 | **Không có cổng phiên** | `src/app/api/accounts/route.ts`, `src/app/api/pages/route.ts`… không kiểm phiên; chỉ nhánh `auth/facebook/*` có OAuth | Ai chạm được cổng là **đọc được token Page** của toàn bộ tài khoản đã kết nối |
| 3 | **Hard-delete — BẤT BIẾN #2** | `DELETE FROM` ở cả 7 repository (`account-repo:155-156`, `content-repo:134`, `media-repo:70`, `page-repo:168`, `plan-repo:51`, `post-repo:253`) | Không có `deleted_at`, không có vết audit |
| 4 | **Không có `company_id`/RLS — BẤT BIẾN #1** | 7 bảng, 0 cột tenant | Chấp nhận được **chỉ khi** app khoá cứng ở một công ty (xem `SOCIAL-DEC-002`) |

### 1.2 Vị trí trong lộ trình — KHÔNG phải thứ đã bị cắt

Đợt de-media-fy (20/06/2026) loại **media/kênh/video/content + tài chính-theo-kênh**. `fbpost` không nằm trong đó: nó khớp module **`SOCIAL`, Phase 4** của lộ trình (CLAUDE.md §1 · SPEC-01 §7/§25) — cùng nhóm với `CHAT` đang thi công ở S7/S8. Vấn đề vì vậy **không phải "ngoài phạm vi"** mà là **"đúng phạm vi, sai giai đoạn"**: hệ đang ở S6 go-live (còn G1·G7·G8·G10 chưa đạt) + wave S8-CHAT-UX. ⇒ Cần owner ký ADR nới giai đoạn, có hàng rào — đúng khuôn `DECISIONS-07` đã làm cho CALL.

---

## 2. Phạm vi wave

**TRONG phạm vi:** đưa `fbpost` vào `apps/fbpost` chạy như dịch vụ riêng; vá 2 lỗ bảo mật chặn triển khai (secret plaintext + cổng phiên); cầu SSO một chiều MediaOS → fbpost; tile app có gate quyền; seed quyền + audit; dịch vụ NSSM cổng riêng; bộ test deny-path.

**NGOÀI phạm vi (cố ý, YAGNI):** port sang NestJS/Postgres/RLS (đó là hướng B, không chọn); `company_id` trong fbpost; kênh NOTI báo bài đăng lỗi (để wave sau nếu có nhu cầu thật); đăng lên nền tảng khác ngoài Facebook Page; hard-delete → soft-delete cho 7 bảng SQLite (xem `SOCIAL-DEC-004`).

---

## 3. Quyết định cần owner ký (`S9-SOCIAL-DOC-1`)

| Mã | Quyết định | Đề xuất | Vì sao |
| --- | --- | --- | --- |
| `SOCIAL-DEC-001` | Nới giai đoạn: kéo module `SOCIAL` từ Phase 4 lên làm **app vệ tinh** ngay | **Đồng ý, có hàng rào R1-R4 ở §3.1** | Code đã có sẵn 65 file chạy được; chi phí nhập ≪ chi phí viết lại |
| `SOCIAL-DEC-002` | fbpost giữ **SQLite, KHÔNG có `company_id`** | Đồng ý — khoá cứng một công ty bằng `SOCIAL_COMPANY_ID`, y hệt `LMS_COMPANY_ID` | LMS đã chạy đúng mô hình này từ S5; ép RLS vào SQLite là vô nghĩa |
| `SOCIAL-DEC-003` | Token Facebook lưu **mã hoá bằng KEK** trong SQLite | Đồng ý — bắt buộc, chặn triển khai | BẤT BIẾN #3; token Page = quyền đăng bài nhân danh công ty |
| `SOCIAL-DEC-004` | **Không** ép soft-delete cho 7 bảng SQLite | Đồng ý — nhưng ghi audit sang MediaOS cho hành động **xoá tài khoản/Page** | BẤT BIẾN #2 nói "dữ liệu quan trọng"; nội dung nháp/media không thuộc nhóm đó, còn việc gỡ một tài khoản FB thì có |
| `SOCIAL-DEC-005` | Code fbpost vào **git monorepo MediaOS** (khác LMS — LMS có repo riêng) | Đồng ý | fbpost **chưa có git**; 65 file thì không đáng lập repo riêng, và vào monorepo thì CI path-filter dùng được ngay |
| `SOCIAL-DEC-006` | Ai được dùng | Đề xuất: quyền mới `SOCIAL.POST.*` + `SOCIAL.ACCOUNT.*`, mặc định **chỉ cấp cho role quản trị + marketing**, KHÔNG cấp đại trà | Token Page là tài sản công ty |

### 3.1 Hàng rào cho `SOCIAL-DEC-001`

- **R1 — Không chen wave đang chạy.** S9-SOCIAL chỉ khởi động khi hàng đợi S8-CHAT-UX rỗng hoặc owner chỉ định rõ; 3 WO đỏ đang READY (`S7-CALL-DOC-1`, `S8-CHAT-UX-DB-1`, `S8-CHAT-UX-RT-1`) **giữ ưu tiên cao hơn**.
- **R2 — Không đụng `apps/api` ngoài đúng 2 điểm.** Cầu SSO (`src/integrations/social/`) + 1 migration seed quyền. Mọi thứ khác nằm trong `apps/fbpost/**`.
- **R3 — Không vào root pnpm workspace.** Thêm `!apps/fbpost` vào `pnpm-workspace.yaml` như `!apps/lms` — root `pnpm install`/`turbo` KHÔNG được đụng tới (fbpost dùng `package-lock.json`/npm, Tailwind v4 riêng).
- **R4 — Không dùng chung `dist`/thư mục build với PROD.** Xem bẫy `prod-dist-shared-with-devonline-landmine` + `lms-next-build-shares-prod-dist`: `next build` của LMS từng ghi đè `dist` PROD làm login 500.

---

## 4. Phân rã Work Order

```text
DOC-1 (đỏ, owner ký)
  └─ SEC-1 (đỏ)  ── vá secret plaintext + cổng phiên, LÀM TẠI C:\fbpost trước khi nhập
       └─ APP-1 (vàng) ── nhập cây code vào apps/fbpost
            ├─ DB-1  (đỏ)  ── migration seed quyền SOCIAL.* + audit object_type
            │    └─ BE-1 (đỏ) ── cầu SSO /integrations/social/sso-link (sao khuôn LmsSsoService)
            │         └─ FE-1 (vàng) ── tile app + gate quyền + mở thẳng
            └─ DEVOPS-1 (vàng) ── NSSM cổng 3500 + .env.production + quy trình build/restart
                 └─ QA-1 (vàng) ── deny-path + replay SSO + không rò token
```

| WO | Zone | Nội dung cốt lõi |
| --- | --- | --- |
| `S9-SOCIAL-DOC-1` | 🔴 | Owner ký ADR `DECISIONS-08_Social_Satellite_App.md` (6 quyết định §3 + 4 hàng rào §3.1); bổ sung `SOCIAL` vào danh mục module của `harness/backlog.mjs` |
| `S9-SOCIAL-SEC-1` | 🔴 | Mã hoá 3 cột credential bằng KEK (sao khuôn cơ chế KMS của `apps/api`); thêm cổng phiên chặn **20/21** route (`auth/facebook/callback` là lối vào OAuth, gate bằng `state` chứ không bằng phiên); migrate dữ liệu token đang có sang dạng mã hoá |
| `S9-SOCIAL-APP-1` | 🟡 | `git init` + copy cây vào `apps/fbpost` (bỏ `node_modules`, `.next`, `data/`, `tsconfig.tsbuildinfo`); thêm `!apps/fbpost` vào `pnpm-workspace.yaml`; CI path-filter; README trỏ về wave này |
| `S9-SOCIAL-DB-1` | 🔴 | Migration `0544+`: seed cặp quyền `('view','social-post')` · `('create','social-post')` · `('manage','social-account')`; **append** `'social_sso'` vào CHECK union `object_types` — nhớ CHECK nằm ở **hai** bảng (memory `noti-catalog-check-lives-on-two-tables`) |
| `S9-SOCIAL-BE-1` | 🔴 | `SocialSsoService` sao khuôn [lms-sso.service.ts](../../apps/api/src/integrations/lms/lms-sso.service.ts): HMAC-SHA256, TTL 60s, `jti` một-lần, **audit ghi TRƯỚC khi trả URL** (fail-closed); phía fbpost thêm `/api/auth/sso` + bảng `sso_consumed_tokens` |
| `S9-SOCIAL-FE-1` | 🟡 | Tile "Đăng bài" trong `APP_REGISTRY` ([registry.ts](../../packages/web-core/src/lib/registry.ts)) + [AppSwitcher.tsx](../../apps/app/src/layouts/home/AppSwitcher.tsx); mở thẳng không qua trang trung chuyển, sao khuôn [open-lms.ts](../../apps/app/src/routes/lms/open-lms.ts) |
| `S9-SOCIAL-DEVOPS-1` | 🟡 | Dịch vụ NSSM `MediaOS-Social` cổng **3500** (LMS đang 3400); `.env.production`; quy trình build + restart **tách hẳn** thư mục build khỏi PROD (R4) |
| `S9-SOCIAL-QA-1` | 🟡 | Deny-path RED-trước: gọi route fbpost không phiên → 401 · token SSO dùng lại lần 2 → từ chối · user không có quyền `SOCIAL.*` → không thấy tile và không mint được link · token FB không xuất hiện trong bất kỳ response/log nào |

---

## 5. Rủi ro đã biết

| Rủi ro | Ứng phó |
| --- | --- |
| `next build` của fbpost ghi đè thư mục build PROD → login 500 | R4; verify bằng nội dung `dist` chứ không bằng PID/log (memory `prod-restart-does-not-rebuild-dist`) |
| Worker in-process nhân đôi khi có nhiều tiến trình | Đã có chốt `globalThis` + chặn `NEXT_PHASE=phase-production-build` trong `worker-boot.ts`; **verify lại** khi chạy dưới NSSM |
| Token Facebook hết hạn im lặng → bài không đăng mà không ai biết | Ngoài phạm vi wave này; ghi nợ vào `done_when` của QA-1 dưới dạng quan sát được (`token_expires_at` có sẵn trong bảng `accounts`) |
| Mã hoá token làm hỏng dữ liệu đang có ở `C:\fbpost\data` | SEC-1 phải backup `data/fbpost.db` trước khi migrate, và migrate phải chạy được **hai lần** không hỏng |
| Nhập app mới lúc S6 go-live chưa đóng | R1 — owner quyết thứ tự; wave này KHÔNG tự khởi động |

---

## 6. Định nghĩa hoàn thành cho cả wave

Người dùng có quyền `SOCIAL.POST.CREATE` bấm tile "Đăng bài" trong MediaOS → vào thẳng fbpost đã có phiên (không phải đăng nhập lại) → soạn và hẹn giờ bài lên Page → bài lên đúng giờ. Người **không** có quyền không thấy tile và không mint được link SSO. Token Facebook trong `data/fbpost.db` ở dạng mã hoá, không đọc được bằng `sqlite3`. `bash harness/check.sh --all` XANH có bằng chứng `LANE_DB`.
