# S5-LMS-BE-1 — Micro-plan (🔴 crown · zone=red · gate FULL)

> WO: `harness/backlog.mjs` → `S5-LMS-BE-1`. Wave: [S5-LMS-WAVE.md](S5-LMS-WAVE.md) §4 B01/B02 + §7.
> Mục tiêu: **auto-sync tài khoản MediaOS→LMS** — HR cho nghỉ/khoá + admin khoá/mở user → LMS khoá/mở
> theo (event-driven); nhân viên mới → có tài khoản LMS (job đối soát). Hết chạy tay `sync-lms-users.mjs`.
>
> **depends_on: S5-LMS-DB-1** (audit type `lms_sync` từ mig 0509). Nhánh **sibling của BE-2**, cùng off
> `wo/S5-LMS-DB-1` (KHÔNG stacked lên BE-2 — file khác nhau trong integrations/lms).

---

## 0. Kiến trúc (đã xác minh code THẬT — Explore survey)

```
  PRODUCER (trong tx nghiệp vụ)                  BRIDGE (outbox-worker dispatch)         JOB (đối soát)
  ┌─────────────────────────────┐               ┌──────────────────────────────┐        ┌──────────────┐
  │ HrWriteService.changeStatus  │──enqueue──┐   │ LmsUserSyncBridge            │        │ LmsUserSync  │
  │ authUsers.lockUser/unlockUser│           │   │ EventBus.register            │        │ JobHandler   │
  └─────────────────────────────┘           ▼   │  consumerName lms-sync:<evt> │        │ @SystemJob   │
           qua LmsSyncProducer      outbox_events│  handle → LmsHttpClient POST │        │ jobCode      │
           (resolve {email,name,    (cùng tx)   │  throw khi LMS lỗi → retry×5 │        │ LMS_USER_SYNC│
            active} + enqueue)                   │  → dead-letter               │        └──────────────┘
                                                 └──────────────────────────────┘   (reconcile all users)
                                   eventType = "hr.employee_status_changed" (RIÊNG — KHÔNG auth.user_locked)
```

**Sự thật khoá cứng (survey):**
- `OutboxService.enqueue(tx, {eventType, payload})` — insert cùng tx (rollback nghiệp vụ ⇒ event biến mất).
- Outbox-worker: `EventBus.consumersFor(eventType)` → `consumer.handle({eventId, companyId, eventType, payload})`; consumer **throw** → retry ×5 (`MAX_ATTEMPTS`) backoff 30s → `deadLetter` + alert. Idempotency per `(consumerName, eventId)`.
- `EventBus.register({consumerName, eventType, handle})` — `consumerName` DUY NHẤT toàn hệ; nhiều consumer/eventType độc lập.
- `OutboxNotificationBridge` boot-guard **throw** nếu eventCode không ∈ NOTI catalog ⇒ **KHÔNG** dùng cho LMS; đăng ký thẳng `EventBus.register`.
- **⚠ Xác nhận trap #1**: `auth.user_locked` có consumer `noti-bridge:auth.user_locked` (`AuthHrNotiBridgeRegistrar`) gửi notification cho user; khớp theo eventType string ⇒ re-emit từ admin-lock = gửi noti nhầm. Dùng eventType **`hr.employee_status_changed`** (khác) né hoàn toàn.
- `@SystemJobHandler()` + `jobCode` + `run(ctx:{companyId})` tự `withTenant`; đăng ký = có mặt trong `providers[]`; JobRunner enumerate companies, 1 tenant lỗi không chặn tenant kế.
- Script `sync-lms-users.mjs`: query `users ⋈ employee_profiles`, `active = u.status='active' AND ep.status='active'`, POST `{LMS}/api/admin/sync-users` body `{users:[{email,name,active}]}` header `Authorization: Bearer <token>`; token env `MEDIAOS_SYNC_TOKEN`.
- env.schema `LMS_SSO_SECRET`/`LMS_BASE_URL` tại `:208/:210` — thêm `LMS_SYNC_TOKEN: z.string().min(32).optional()`.

---

## 1. Quyết định chốt

| # | Quyết định | Lý do |
| --- | --- | --- |
| **D1 — eventType RIÊNG** `hr.employee_status_changed` | KHÔNG re-emit `auth.user_locked` | Trap #1 (trên). Khớp B01 |
| **D2 — Producer chung** `LmsSyncProducer.enqueueSync(tx, companyId, userId)` | Cả HR lẫn admin-lock gọi. Resolve `{email, name, active}` bằng join `users ⋈ employee_profiles` (INNER — chỉ user CÓ hồ sơ; mirror script), enqueue nếu resolve được; `null` (không hồ sơ / userId null / soft-deleted) → **no-op sạch** | DRY: 1 nơi giữ eventType + shape payload + scope. Producer chỉ cần OutboxService (global) + đọc tx được truyền |
| **D3 — Trigger** | changeStatus: gọi producer khi `row.userId != null` (mọi transition — active suy từ status ⇒ mọi đổi status là LMS-relevant; idempotent nên over-emit vô hại, KHÔNG BAO GIỜ under-sync rehire). authUsers: sau `setLockTx`/`setUnlockTx` | Khớp B01 ("userId==null thì bỏ qua"); rộng hơn "resigned/terminated" nhưng an toàn + đúng hơn |
| **D4 — active tính SAU mutation** | Producer gọi SAU `setStatusTx`(+lockUserTx)/`setLockTx` trong cùng tx ⇒ đọc trạng thái post-change | Payload phản ánh đúng state sẽ commit |
| **D5 — Payload whitelist** `{email, name?, active}` | KHÔNG kéo row nhân sự, KHÔNG userId-PII thừa, KHÔNG token/secret | BẤT BIẾN #3 |
| **D6 — Bridge fail-soft ĐÚNG NGHĨA** | tx HR/auth commit ĐỘC LẬP (event đã trong outbox); bridge chạy ASYNC ở outbox-worker; LMS 5xx/timeout → bridge **THROW** → retry ×5 → dead-letter + alert. **CẤM** catch rỗng rồi markProcessed | done_when "fail-soft ĐÚNG NGHĨA"; memory reviewers-pass-real-bugs |
| **D7 — env-gated, KHÔNG chặn boot** | `LMS_SYNC_TOKEN`/`LMS_BASE_URL` thiếu → HttpClient `isEnabled()=false`: bridge **skip** (markProcessed done, KHÔNG throw — tránh dead-letter oan khi cố ý tắt), job **skip** (total=0), **warn 1 lần** | mirror posture SSO 503; done_when "thiếu env → skip sạch" |
| **D8 — Job ghi audit `lms_sync` summary** | `run(companyId)` → withTenant → audit `{action:'lms_user_sync', objectType:'lms_sync', metadata:{total,ok,fail}}` — **đếm, KHÔNG dump email list** | done_when; BẤT BIẾN #3. Bridge KHÔNG ghi audit riêng (HR/auth action đã audit; outbox/dead-letter là observability) |
| **D9 — HttpClient chung** `LmsHttpClient.syncUsers(users[])` | Bridge gửi 1 user; job gửi cả list (batch). Body `{users:[…]}` Bearer `LMS_SYNC_TOKEN`, timeout, `!ok`→throw | 1 nơi giữ auth + shape HTTP |
| **D10 — Module `LmsSyncModule` RIÊNG** (không import PermissionModule) | providers [LmsHttpClient, LmsSyncProducer, LmsUserSyncBridge, LmsUserSyncJobHandler], exports [LmsSyncProducer]; employees + users module import nó | Tách khỏi `IntegrationsLmsModule` (SSO cần PermissionModule) ⇒ tránh kéo Permission vào employees/users + tránh circular. Mọi dep khác (Outbox/DB/Audit/EventBus) đều @Global |
| **D11 — Script đọc cả 2 tên token** | `sync-lms-users.mjs`: `LMS_SYNC_TOKEN ?? MEDIAOS_SYNC_TOKEN` | B02 tương thích ngược |
| **D12 — COMPANY GATE (must-fix #1 BLOCKING)** | Thêm env `LMS_COMPANY_ID` (uuid, optional). `isEnabled()` = `LMS_BASE_URL` **AND** `LMS_SYNC_TOKEN` **AND** `LMS_COMPANY_ID` đều có. Gate `companyId === LMS_COMPANY_ID` ở **3 tầng**: (a) Producer — `companyId !== LMS_COMPANY_ID` → **KHÔNG enqueue** (chặn tại nguồn, event chéo-tenant KHÔNG BAO GIỜ vào outbox); (b) Job `run` — tenant ≠ LMS-company → early-return `{total:0}` KHÔNG query/POST/audit; (c) Bridge — `ctx.companyId !== LMS_COMPANY_ID` → skip (defense-in-depth) | **JobRunner enumerate MỌI company** + LMS endpoint khoá thuần theo email (KHÔNG company-scope, 1 LMS=funtime). Không gate ⇒ tenant ≠ funtime có hồ sơ → POST email vào LMS funtime (memory pgdata-bloat "122 company test lọt PROD"). Script tay CÓ `--company-slug funtime`; tự-động-hoá PHẢI giữ scope đó. `LMS_COMPANY_ID` thiếu → tính năng TẮT (fail-closed isolation) |
| **D13 — Producer KHÔNG inject HttpClient** (fail-soft cấu trúc) | `LmsSyncProducer` chỉ làm DB resolve + `OutboxService.enqueue` — **ZERO HTTP/network trong tx nghiệp vụ**. LMS chết KHÔNG BAO GIỜ chạm tx HR/auth. Resolve/enqueue lỗi = lỗi DB thật → fail-loud rollback (đúng — không phải LMS-availability) | must-fix W2. Test cấu trúc: constructor producer KHÔNG có LmsHttpClient |

---

## 2. Phạm vi (file)

**MỚI (integrations/lms):** `lms-http-client.service.ts` · `lms-sync-producer.service.ts` ·
`lms-user-sync.bridge.ts` · `lms-user-sync.job-handler.ts` · `lms-sync.module.ts` + spec đi kèm.
**SỬA:** `config/env.schema.ts` (+`LMS_SYNC_TOKEN` z.string().min(32).optional() +`LMS_COMPANY_ID` z.string().uuid().optional()) · `employees/hr-write.service.ts` (gọi producer) ·
`employees/employees.module.ts` + `users/*.module.ts` (import LmsSyncModule) ·
`users/auth-users.service.ts` (inject producer, gọi trong lock/unlock) · `sync-lms-users.mjs` (token) · `.env.example`.
**TEST:** `test/integration/lms-user-sync.int-spec.ts` (MỚI) + unit spec cho producer/bridge/httpclient/job.
**NGOÀI:** migration (ở DB-1) · `auth.service.ts` auto-lock (KHÔNG đụng — chỉ verify KHÔNG sinh event LMS) · `apps/lms` · notification pipeline.

---

## 3. Các bước

1. **RED** (deny-path/behavior TRƯỚC): int-spec + unit specs → đỏ (chưa có class/method).
2. **GREEN**: env → HttpClient → Producer → wire HR + authUsers → Bridge → Job → module.
3. **Verify** `LANE_DB=mediaos_lmsdb1`: `pnpm --filter @mediaos/api test` (unit+int) · typecheck · lint · `bash harness/check.sh --all`.
4. **Gate FULL**: `security-reviewer` + `silent-failure-hunter` (crown HR+auth + secret token + fail-soft).
5. **PR** off DB-1, KHÔNG auto-merge; ghi "sibling #260, cần #259 merge trước + owner set `LMS_SYNC_TOKEN` PROD".

---

## 4. Test plan

**Unit:**
- `lms-http-client.service.spec`: isEnabled theo env; syncUsers body `{users:[…]}` + `Bearer` đúng (mock fetch); `!ok`/timeout → throw; thiếu env → throw/skip theo hợp đồng.
- `lms-sync-producer.spec`: resolve→enqueue eventType `hr.employee_status_changed` payload `{email,name,active}` (mock tx query + outbox); userId không hồ sơ → **KHÔNG** enqueue; KHÔNG token/secret trong payload.
- `lms-user-sync.bridge.spec`: handle gọi HttpClient đúng user; LMS throw → **re-throw** (để retry); thiếu env → skip KHÔNG throw.
- `lms-user-sync.job-handler.spec`: run gom users, gọi HttpClient, trả `{total,ok,fail}`; thiếu env → total 0 skip.

**Integration — `lms-user-sync.int-spec.ts`** (gate `hasDb && LANE_DB`, seed company+users+profiles):

| # | Ca | Kỳ vọng | RED? |
| --- | --- | --- | --- |
| I1 | changeStatus → resigned (user linked) | 1 row `outbox_events` eventType=`hr.employee_status_changed` payload `{email, active:false}` (CÙNG tx) | ✅ |
| I2 | admin `lockUser` | outbox có event `hr.employee_status_changed` active:false **VÀ** KHÔNG có event `auth.user_locked` phát sinh mới (né trap #1) | ✅ |
| I3 | admin `unlockUser` (ep active) | event active:true | ✅ |
| I4 | changeStatus với `userId=null` (employee chưa gán account) | KHÔNG enqueue event | ✅ (xanh sẵn nếu skip đúng) |
| I5 | auto-lock sai mật khẩu (mô phỏng emitAccountLocked) | KHÔNG sinh event `hr.employee_status_changed` (chỉ auth.user_locked) | ✅ |
| I6 | Bridge handle (LMS mock 200) | POST đúng body `{users:[{email,name,active}]}` Bearer đúng | ✅ |
| I7 | Bridge handle (LMS mock 500) | handle **throw** (⇒ outbox retry); tx HR đã commit trước đó độc lập | ✅ |
| I8 | thiếu `LMS_SYNC_TOKEN`/`LMS_COMPANY_ID` | bridge skip KHÔNG throw; job total=0; producer KHÔNG enqueue (disabled) | ✅ |
| I9 | Job reconcile (LMS mock, tenant=LMS-company) | quét đúng users×profiles, POST body có `name` (đường TẠO account), ghi audit `lms_sync` actorType=`Job` summary (KHÔNG email list) | ✅ |
| **I10** | **ISOLATION 2-tenant (must-fix #1)**: company B (≠ LMS_COMPANY_ID) — changeStatus/lockUser + job chạy cho B | **0 enqueue** + **0 POST** + **0 audit lms_sync**; chỉ company LMS mới sync | ✅ |
| I11 | admin `lockUser` user KHÔNG có hồ sơ (vd admin@) | KHÔNG enqueue (no-op authUsers — khác I4 đường changeStatus) | ✅ |
| I12 | **rollback cùng-tx (W2)**: business tx (changeStatus) rollback | outbox event `hr.employee_status_changed` **biến mất** (chứng minh enqueue trong tx) | ✅ |

## 5. Rủi ro / bẫy

- **Trap #1 re-emit auth.user_locked** → D1 (eventType riêng) + I2/I5 canh.
- **Fail-soft giả** (catch rỗng nuốt lỗi LMS) → D6 + I7 (throw để retry). memory reviewers-pass-real-bugs.
- **Circular DI** employees/users→lms → D10 (LmsSyncModule không import Permission; deps global).
- **Producer đọc state TRƯỚC mutation** → D4 (gọi SAU set*Tx).
- **PROD thiếu LMS_SYNC_TOKEN** → D7 skip sạch; owner set token PROD trước khi bật (checklist wave §6).
- **Sibling BE-2**: cùng off DB-1, khác file — merge độc lập sau khi #259 merged (rebase lên master).
- **Đỏ-giả**: LANE_DB + TURBO_FORCE=1.

## 6. Definition of Done

`done_when` WO + unit+int xanh lane DB + typecheck/lint + `harness/check.sh --all` xanh + FULL gate PASS +
ledger + PR off DB-1 (KHÔNG auto-merge) ghi: cần #259 merge trước + owner set `LMS_SYNC_TOKEN` PROD/.env.
