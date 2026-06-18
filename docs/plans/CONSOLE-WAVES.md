# CONSOLE UPGRADE — KẾ HOẠCH WAVE SONG SONG

> Phân rã 10 lane CS-1…CS-10 ([CONSOLE-SYSTEM-UPGRADE.md](./CONSOLE-SYSTEM-UPGRADE.md)) thành **4 wave** chạy song song.
> Tuân thủ: CS-1 trunk land TRƯỚC fan-out · **≤2 crown Opus/wave** (memory rate-limit) · band migration không đụng ·
> **DB cô lập mỗi lane** (CLAUDE §9.6) · merge theo `when` tăng dần. Fan-out 1 wave = Workflow `parallel-lanes`.

## 1. Đồ thị phụ thuộc (DAG)

```
                         CS-1  (TRUNK: sidebar 1→2 cấp + audit) — land TRƯỚC
        ┌───────────┬───────────┬───────────┬───────────┐
      CS-2        CS-3        CS-4        CS-5        CS-7         ← Wave 1 (∥, 1 crown)
     (RBAC)     (org/pos)   (đối tượng) (hồ sơ cty) (usage+last_login)
                              │                        │
                            CS-6 ────────┐           CS-9 ───┐    ← Wave 2 dùng kết quả
                           (recycle)     │          (sec policy)│
                                       CS-8 ─────────┐         │
                                      (mail secret)  └──→ CS-10 ←┘  ← Wave 3
                                                        (invite: cần CS-8 mail + CS-9 email-domain)
```

**Phụ thuộc bắt buộc:**
- Mọi lane rebase off **CS-1** (shell nav/router 2 cấp + `NavItem.subcategory`).
- **CS-7 → CS-9**: cả hai sửa `auth.service.login`; CS-7 (ghi `last_login_at`) land trước → CS-9 rebase thấy thay đổi, không đụng độ.
- **CS-4 → CS-6**: cùng domain `employees`; CS-6 (recycle) rebase off CS-4.
- **CS-8 → CS-10** (gửi mail) và **CS-9 → CS-10** (email-domain check tại accept).

## 2. Bảng wave

| Wave | Lanes | Crown | Band migration | Ghi chú |
| --- | --- | --- | --- | --- |
| **0 — Trunk** | CS-1 | 0 | — | SOLO. Land + push trước fan-out. Mở khoá nav/router cho mọi lane. |
| **1 — Fan-out** | CS-2 · CS-3 · CS-4 · CS-5 · CS-7 | **1** (CS-2) | CS-5 `0360` · CS-7 `0370` | 5 lane ∥. Domain disjoint. CS-7 ghi `last_login_at` vào login. |
| **2 — Secret+cleanup** | CS-6 · CS-8 · CS-9 | **2** (CS-8, CS-9) | CS-8 `0380` · CS-9 `0390` | CS-8/CS-9 file disjoint (crypto/mail vs auth/policy); hot-file chỉ append. CS-6 rebase off CS-4. |
| **3 — Final** | CS-10 | **1** | CS-10 `0410` | SOLO. Cần CS-8 + CS-9 đã land. |

**Đường găng (critical path):** CS-1 → CS-7 → CS-9 → CS-10 = 4 wave. Phần còn lại chạy nấp dưới.

## 3. Cấu hình từng lane (cho `parallel-lanes`)

| Lane | Worktree | DB cô lập | Model | Gate | Reviewers/skills |
| --- | --- | --- | --- | --- | --- |
| CS-1 | `mediaos-cs1` | `mediaos_cs1` | Sonnet | LIGHT | typescript + react + quality |
| CS-2 | `mediaos-cs2` | `mediaos_cs2` | **Opus** | FULL | security + silent-failure + react + quality |
| CS-3 | `mediaos-cs3` | `mediaos_cs3` | Sonnet | LIGHT | typescript + react + quality |
| CS-4 | `mediaos-cs4` | `mediaos_cs4` | Sonnet | LIGHT | typescript + react + quality |
| CS-5 | `mediaos-cs5` | `mediaos_cs5` | Sonnet | LIGHT | database + typescript + react |
| CS-7 | `mediaos-cs7` | `mediaos_cs7` | Sonnet | 🟡 LIGHT+ | database + silent-failure (đụng `auth.service.login`) |
| CS-6 | `mediaos-cs6` | `mediaos_cs6` | Sonnet | LIGHT | typescript + quality (chú ý RLS restore) |
| CS-8 | `mediaos-cs8` | `mediaos_cs8` | **Opus** | FULL | security + database + silent-failure + **santa** |
| CS-9 | `mediaos-cs9` | `mediaos_cs9` | **Opus** | FULL | security + database + silent-failure + **santa** |
| CS-10 | `mediaos-cs10` | `mediaos_cs10` | **Opus** | FULL | security + silent-failure + **santa** |

> Crown = CS-2, CS-8, CS-9, CS-10 → planner (Opus) micro-plan TRƯỚC code. CS-9 micro-plan: [CS-9-security-policy.md](./CS-9-security-policy.md) (đã có). CS-8/CS-10 cần micro-plan trước Wave 2/3.

## 4. Quy tắc reconcile khi merge (hot-file = APPEND, không rewrite)

| Hot-file | Lane chạm | Cách hòa |
| --- | --- | --- |
| web-core `NavItem` + `AppSidebar` (cấu trúc 2 cấp) | **CHỈ CS-1** | Land Wave 0; lane sau chỉ THÊM nav item (data), không đổi cấu trúc. |
| console `nav.ts` + `router.tsx` | mọi lane | mỗi lane append 1 route + 1 nav item → union khi merge. |
| permission seed | CS-2/6/7/8/9/10 | `ON CONFLICT DO NOTHING`; key mới gán role system-admin. |
| audit `object_types` CHECK | CS-6/8/9/10 | **UNION** thêm `recycle_restore`/`mail_config`/`security_policy`/`user_invite`; DO-block parse cả IN-list & ANY-array. |
| `app.module` providers · `schema/index.ts` | lane có module/bảng mới | khối additive. |
| `auth.service.login` | **CS-7 + CS-9** | CS-7 land TRƯỚC (Wave 1); CS-9 (Wave 2) rebase off → graft enforce vào sau last_login. |
| `secret-encryption.types.ts` (KeyPurpose) | CS-8 | thêm `'smtp_password'` — 1 dòng, không đụng lane khác. |

**Thứ tự merge:** trong wave, land theo band tăng dần (`when` monotonic): Wave 1 → CS-5(0360) trước CS-7(0370); Wave 2 → CS-8(0380) trước CS-9(0390). Lane không-migration (CS-2/3/4/6) xen kẽ tự do. Mỗi merge: chain `0000→latest` apply sạch trên DB cô lập + test xanh + gate đạt (+ santa cho crown).

## 5. Tiền-điều-kiện mỗi wave (BẮT BUỘC)

1. **DB cô lập:** `bash scripts/lane-db-setup.sh cs<n>` → `export LANE_DB=mediaos_cs<n>` trước verify. KHÔNG dùng `mediaos` chung (band cao migrate DB chung → skip band thấp lane khác → xanh-giả).
2. **KEK:** `cp .secrets/local-kek.bin` vào worktree CS-8/CS-9 (gitignore không theo `worktree add` → false-RED).
3. **Build contracts TRƯỚC typecheck** ở worktree mới (`pnpm install` + build `@mediaos/contracts`) — tránh false-RED.
4. **Crown budget:** đếm crown thật bằng `parallel-lanes` `dryRun:true` trước khi fan-out; KHÔNG vượt 2 crown/wave (rate-limit giết agent → lane drop âm thầm).

## 6. Cách chạy (gợi ý)

```
Wave 0:  code CS-1 (1 phiên) → land master → push.
Wave 1:  Workflow parallel-lanes [CS-2,CS-3,CS-4,CS-5,CS-7]  (dryRun trước → 1 crown OK)
         → land theo band → push.
Wave 2:  Workflow parallel-lanes [CS-6,CS-8,CS-9]            (2 crown = trần; micro-plan CS-8 trước)
         → land CS-8→CS-9, CS-6 xen → push.
Wave 3:  code CS-10 (cần CS-8+CS-9) → land → push.
```

> Mỗi wave: rebase lane off master mới nhất → RED→GREEN→gate→checkpoint → land. Sau mỗi wave đối chiếu `git log` + timestamp (memory: sau run nặng Workflow có thể kẹt → mở phiên mới nếu agent 0/instant).

### 6.1 Checklist khởi động Wave 1 (sau RESTART process Claude Code)

> Wave 0 ✅ landed `98293b2`. Workflow runtime đã jam ở phiên trước (post-compaction cùng process) → **PHẢI restart hẳn process** (quit+reopen), không phải chỉ chat mới, mới spawn được agent. Sau restart:

1. **Invoke bằng `scriptPath`, KHÔNG bằng name:** session root là `c:\dev 2` (không phải `MediaOS`) nên `Workflow{name:'parallel-lanes'}` báo *not found*. Dùng `Workflow{scriptPath:"C:/dev 2/MediaOS/.claude/workflows/parallel-lanes.mjs", args:{...}}`.
2. **dryRun TRƯỚC** (`args.dryRun:true`) → xác nhận ĐÚNG **1 crown = CS-2** (CS-3/4/5/7 không chứa từ khoá crown; nếu lane nào lỡ auto-crown vì task chứa "permission/rls/policy/secret" thì sửa task text hoặc `noReview:true`+`model:'sonnet'`). dryRun instant/0-agent là BÌNH THƯỜNG (không phải jam).
3. **Pre-create 5 worktrees off master** + chuẩn bị mỗi cái trước khi verify (workflow KHÔNG tự tạo worktree): `git worktree add -b feat/cs<n>-… "c:/dev 2/mediaos-cs<n>" master`; rồi trong mỗi worktree `pnpm install` + **build dep dist theo thứ tự** `contracts → web-core → ui` (lane đổi public API package nào thì dependents cần dist mới — xem memory build-before-typecheck). CS-5/CS-7 có migration (band 0360/0370) → cần DB cô lập `lane-db-setup.sh cs5|cs7` + Docker Postgres chạy.
4. **Land theo band tăng dần** trong wave: CS-5(0360) trước CS-7(0370); lane no-migration (CS-2/3/4) xen tự do. Mỗi land: merge --no-ff vào master + rebuild dep dist + typecheck + test 3 pkg liên quan.
5. Nếu Workflow lại jam giữa wave (run thật 0-agent/~20ms) → fallback **direct-Agent** từng lane (đã chứng minh ở Wave 0), hoặc restart lại process.

> **Nợ chưa xong:** master local ahead origin **23** commit (gồm CS-1) — **CHƯA push** (cần xác nhận rõ ràng "push master" vì push thẳng default branch là high-severity, classifier chặn input mơ hồ).

## 7. Trạng thái

- [x] Wave 0 — CS-1 ✅ landed master local `98293b2` (--no-ff merge, 2026-06-18). 121 test xanh (web-core 54 · ui 16 · console 51), typecheck 3 pkg sạch, 0 breaking 4 app khác. ⚠️ CHƯA push (master ahead origin 23). Chạy bằng direct-Agent (Sonnet) vì Workflow runtime jam 0-agent (continuation post-compaction cùng process — xem memory). Nợ MEDIUM/LOW non-block: subcategory raw-string vs i18n key (quyết định convention trunk), redundant `key` trên `<Link>`, UTC date-filter `toISOString()`, 1 filter-change test nông.
- [x] Wave 1 — CS-2 · CS-3 · CS-4 · CS-5 · CS-7 ✅ **LANDED master local 2026-06-18** (chưa push; master ahead origin/master `98293b2` **12 commit**). Chạy bằng **direct-Agent ∥** (CS-2 Opus crown + 4 Sonnet), KHÔNG Workflow (runtime dryRun OK nhưng land thật điều khiển tay cho chắc reconcile). Merge tuần tự CS-2(`fed9d1b`)→CS-3(`dcf3ae8`)→CS-4(`5f036e7`)→CS-5(`d4f79f1`, mig 0360 idx106)→CS-7(`019fa33`, mig 0370 **re-stamp idx107/when1717500420000**) + reconcile fix `5387888`. **Verify master:** chain `0000→0370` áp sạch (companies hồ sơ + users.last_login_at + perm `view:usage`); api **2504 pass**/1 flaky-outbox(pre-existing, xanh-riêng)/5 skip · console **115** · web-core **54** · ui **16** · typecheck 4 pkg sạch. CS-2 crown: security-review độc lập = OK (escalation operator-role chặn ở repo layer `operator-roles.ts` + RLS WITH CHECK, verified live RLS).
  - **GOTCHA land:** (1) docs commit `8095403` lên master SAU khi tạo worktree → diff `master..branch` hiện docs là "deletions" (vô hại, merge 3-way giữ docs). (2) lane DB: default pw script (`changeme_dev_only`) SAI — pw thật trong `.env` (`OWNER_DB_PASSWORD=oeM0…`); host TCP (migrate/vitest) cần pw thật, container-socket dùng trust. Pre-create 5 lane DB tay. (3) nav.ts/router.tsx = union mỗi merge (CS-2/3/4/7); CS-5 KHÔNG đụng. (4) nav LABEL ở web-core `i18n/locales/vi/nav.ts` — lane quên thêm → thêm tay (orgStructure/objects/usageStats; permissions+positions đã có). (5) CS-7 `usage.service.spec.ts` implicit-any self-ref `terminal` → annotate type. (6) stale dist sau merge → rebuild contracts→web-core→ui TRƯỚC typecheck (UsageQuery false-RED).
  - **DEBT (non-block):** CS-2 export shared `OPERATOR_ROLE_IDS` (hiện hardcode 3 file: auth.service/operator-bootstrap/operator-roles → drift risk). CS-3 org-chart = recursive list (console thiếu `@xyflow/react`). CS-4 cột phone "—" (EmployeeListItemDto thiếu) + tab "Người dùng"==="Nhân viên" tới CS-10. CS-7 key `view:usage` (≠ plan `view-usage:company`, tương đương). i18n CS-3/4/7 raw-vi trong console namespace JSON. Pre-existing api lint 30 (seed scripts, ngoài scope).
- [x] Wave 2 — CS-6 · CS-8 · CS-9 ✅ **LANDED master local 2026-06-18** (chưa push; master ahead origin/master `98293b2` **35 commit**, tip docs `73fd35d` / code `5071d39`). Chạy **direct-Agent ∥** (CS-6 Sonnet + CS-8/CS-9 Opus crown — 2 crown = trần), KHÔNG Workflow. Land tuần tự theo band: CS-6(`6a0a518`, mig 0350 seed)→CS-8(`cc76ef8`, mig 0380)→CS-9(`168eecf`, mig 0390) + 2 reconcile fix (`9cf43cb` RLS harness, `5071d39` unused-import). **Crown gate (security-review độc lập):** CS-8 = **SAFE-TO-LAND** (8 bất biến secret OK, chứng minh trên live DB; SMTP password chỉ envelope, no-DTO/no-log, sanitize test-error); CS-9 = **SAFE-AFTER-FIXES** → vá HIGH `req.ip` trust boundary (`faf8a29`: env `TRUST_PROXY` default off → bỏ qua XFF, chống spoof dev). **Verify master (fresh DB `mediaos_wave2verify`):** chain `0000→0390` áp sạch; api **2605 pass/0 fail**/5 skip (206 file) · console **136** · web-core **59** · ui **16** · contracts **195** · typecheck 5 pkg (api/console/web-core/ui/contracts) sạch.
  - **CS-6** (Thùng rác): module `recycle-bin` `GET /recycle-bin/employees` (deleted_at IS NOT NULL) + `POST .../:id/restore` (audit `employee.restored`, **reuse object_type `employee` → KHÔNG đụng audit CHECK**); perm mới `restore:employee` sensitive (mig 0350 seed-only). FE `/recycle-bin` tab Người dùng/Nhân viên.
  - **CS-8** (Mail server SMTP, crown): bảng `company_mail_configs` (7 cột envelope, UNIQUE(company,scope)) + purpose `'smtp_password'` (+CHECK encryption_keys +seed key row 'active') + audit type `mail_config` (mig 0380); reuse `SecretEncryptionService`; nodemailer `verify()` only + sanitize. `requiresReauth` **DROPPED-as-DEBT** (isSensitive-only, theo tiền lệ webhook AC-6).
  - **CS-9** (Bảo mật nâng cao, crown): bảng `company_security_policies` (1 hàng/cty) + enforce ở `auth.service.login`+`refresh(token,meta)` (403 `ACCESS_RESTRICTED`) + `TwoFactorEnforcementGuard` **fail-STRICTER** (effective = global||company, KHÔNG hạ sàn) + email-domain ở `resolveUserId` + env `SECURITY_POLICY_ENFORCEMENT_ENABLED` kill-switch (mig 0390). fail-OPEN(IP rỗng)/fail-CLOSED(giờ rỗng); admin-đang-sửa+exempt KHÔNG tự khoá. `requiresReauth` KEPT.
  - **GOTCHA land:** (1) **journal idx collision** — cả 3 lane off cùng tip → mỗi cái idx=108/when=...430000; re-stamp lúc merge: CS-6 `108`, CS-8 `109/...440000`, CS-9 `110/...450000`. (2) hot-file union mỗi merge (app.module/schema-index/contracts-index/nav.ts/web-core-nav/audit.ts-const/_journal); CS-8/9 conflict CHỈ ở những file này (auth-files CS-9-only, không đụng CS-6/8). (3) **audit CHECK = DO-block ADD-only UNION** (parse cả IN & ANY form, mẫu 0320) → tránh superset-reconcile cross-lane. (4) **encryption_keys purpose CHECK** dạng `= ANY('{...}')` (0320 đã rewrite) → DO-block purpose của CS-8 phải dùng nhánh ANY-array (KHÔNG copy verbatim 0320 purpose block — chỉ parse IN-form → vỡ constraint). (5) **RLS harness** `rls-registry.ts` PHẢI thêm bảng mới (`company_mail_configs`+`company_security_policies`) — lane đơn-lẻ KHÔNG bắt được (DB lane chỉ có 1 bảng mới); full-suite master mới lộ → `9cf43cb`. (6) **lane-DB verify host-TCP**: pw thật trong `.env` (mediaos/mediaos_app/mediaos_worker mỗi role pw riêng) → vitest fallback `changeme_*` FAIL auth; phải export `DATABASE_URL/DIRECT_URL/WORKER_URL` (swap db→mediaos_wave2verify) HOẶC `OWNER_DB_PASSWORD` cho lane-db-setup. (7) console build (vite) qua nhưng `tsc --noEmit` bắt unused import (`5071d39`).
  - **DEBT (non-block):** CS-8 `requiresReauth` dropped (FE step-up window keyed userId+accountId, không hợp PUT settings singleton); CS-8 SMTP `host/port` → blind SSRF/port-scan oracle (gated sensitive perm, giống webhook — DEFER egress-allowlist). CS-9 `useIdleLogout` hook BUILT nhưng CHƯA mount app-wide (cần `auto_logout_minutes` ở `/auth/me` → CS-10 follow-up; backstop = access-token TTL ngắn); `applyScope='selected'` lưu nhưng MVP enforce 'all' (errs stricter); `req.ip` prod cần ops set `TRUST_PROXY`; guard 2FA cache 30s (staleness ≤30s, stricter-only). i18n raw-vi console namespace như Wave 1.
- [ ] Wave 3 — CS-10 (mời/duyệt/kích hoạt user) — prereq CS-8(mail)+CS-9(email-domain) ✅ đã land → sẵn sàng. SOLO, 1 crown, mig band 0410.
