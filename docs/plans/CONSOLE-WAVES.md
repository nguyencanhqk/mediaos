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
- [ ] Wave 1 — CS-2 · CS-3 · CS-4 · CS-5 · CS-7
- [ ] Wave 2 — CS-6 · CS-8 · CS-9
- [ ] Wave 3 — CS-10
