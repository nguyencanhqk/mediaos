# AUTOMATION PLAYBOOK — Tự động hoá chất lượng & tự sửa lỗi (Solo + Claude Code)

> Bộ máy vận hành để code MediaOS **tự test · tự check · tự sửa** theo nguyên tắc:
> **truy root-cause kỹ — quản trị rủi ro — sạch tới đâu chắc tới đó — bước nhỏ commit — song song khi độc lập.**
> Đọc cùng [`CLAUDE.md`](../CLAUDE.md) (3 bất biến + review gate) và [`TASKS.md`](../TASKS.md) (chế độ làm mỗi task).

---

## 0. Nguyên tắc cốt lõi (luật, không phải gợi ý)

1. **Root-cause, không vá triệu chứng.** Mọi lỗi phải tìm *nguyên nhân gốc* rồi mới sửa. Cấm: nuốt lỗi (`catch {}` rỗng), `@ts-ignore`/`eslint-disable` để qua, sửa test cho khớp bug, hard-code giá trị để "hết đỏ".
2. **Quản trị rủi ro — không lan ra chỗ khác.** Mỗi thay đổi cô lập trong 1 nhánh/1 bước; chạy lại **regression test lõi** (đặc biệt test isolation 2-tenant `G2-5`) sau mỗi sửa. Nếu một fix làm hỏng test khác → dừng, không chồng fix lên fix.
3. **Sạch tới đâu chắc tới đó.** Mỗi bước nhỏ xong là: lint sạch · typecheck sạch · test xanh · không dead-code mới. Không để "nợ" tích lại.
4. **Bước nhỏ → commit → nối ở bước lớn.** 1 commit = 1 thay đổi logic nhỏ, revert được độc lập. Gom thành feature/phase ở nhánh, merge khi cả cụm xanh.
5. **Song song khi độc lập.** Việc không đụng nhau (module CRUD khác nhau, chiều review khác nhau) chạy song song để tiết kiệm thời gian; việc đụng schema/lõi chung thì tuần tự.
6. **Tự động PHÂN TẦNG.** Mức tự động khác nhau theo vùng rủi ro (mục 2). Không "auto-fix + auto-commit" đồng đều cho mọi code.

---

## 1. Vòng lặp chuẩn cho 1 micro-step

> Áp cho MỌI task. Một micro-step = thay đổi nhỏ nhất có nghĩa (1 endpoint, 1 bảng, 1 component).

```text
┌─ 1. SCOPE ──────── Xác định 1 micro-step. Vùng xanh hay đỏ? (mục 2) → chọn model + gate.
│
├─ 2. RED ────────── (chỉ vùng 🛠️) Viết test deny-path/thất bại TRƯỚC. Chạy → phải ĐỎ.
│
├─ 3. IMPLEMENT ──── Code tối thiểu để xanh. Vùng xanh: Claude sinh. Vùng đỏ: bạn lái từng diff.
│
├─ 4. AUTO-CHECK ─── lint · typecheck · test (đổi gì test nấy) · review agent theo gate.
│        │
│        ├─ XANH → bước 5
│        └─ ĐỎ  → 4b. ROOT-CAUSE (mục 5): tìm nguyên nhân gốc → sửa → quay lại 4.
│                  (Cấm vá triệu chứng. Nếu 2 vòng chưa ra gốc → ghi lại + hỏi người.)
│
├─ 5. CLEAN ──────── refactor-cleaner / simplify trên đúng diff vừa sửa. Xoá dead-code mới.
│
├─ 6. REGRESSION ─── Chạy lại test lõi (isolation tenant + suite phase hiện tại). Phải còn xanh.
│
└─ 7. COMMIT ─────── Conventional commit, 1 bước logic. Đẩy lên nhánh feature.
         → quay lại 1 cho micro-step kế. Hết cụm → integrate + FULL gate → merge (mục 6).
```

---

## 2. Tự động PHÂN TẦNG — vùng xanh vs vùng đỏ (THIẾT KẾ AN TOÀN)

Mức tự động được quyết bởi diff chạm vào đâu:

| Vùng | Diff chạm | Model | Gate | Auto-fix? | Auto-commit? | Auto-merge? |
| --- | --- | --- | --- | --- | --- | --- |
| 🟢 **XANH** | CRUD, list/detail, form, dashboard UI, docs, style | Haiku/Sonnet | LIGHT (`ecc:typescript-reviewer` + `ecc:quality-gate`) | ✅ tự sửa lint/type/test | ✅ khi gate xanh | ✅ vào nhánh feature |
| 🟡 **VÀNG** | workflow logic, task hub, notification, KPI calc, chat realtime | Sonnet/Opus | LIGHT + test logic | ✅ nhưng **báo diff** | ✅ khi gate xanh | ⚠️ bạn xem trước khi merge bước lớn |
| 🔴 **ĐỎ** | `permission · RLS · secret/encrypt · payroll · finance snapshot · audit · migration` | **Opus** | **FULL** (`ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` [+ `ecc:santa-method`]) | ❌ **không tự sửa mù** — phải root-cause + người duyệt | ❌ **không auto-commit** | ❌ **người merge tay** |

> **Vì sao tách đỏ:** đúng lúc AI sai ở permission/payroll là lúc mất tiền/lộ dữ liệu chéo tenant. Vùng đỏ đổi triết lý: AI *đề xuất*, test *chứng minh*, **người chốt**. 3 hook guard (`guard-tenant/secret/immutability`) là chốt chặn cứng cuối cùng.

Vùng của mỗi task đã có sẵn trong [`TASKS.md`](../TASKS.md): nhãn 🛠️🔋 ≈ đỏ/vàng, 🤖🟢 ≈ xanh.

---

## 3. Bản đồ định tuyến Agent/Skill (dùng đúng, ít lỗi)

| Tình huống | Dùng | Khi nào |
| --- | --- | --- |
| Lên kế hoạch 1 phase/feature lớn | `ecc:plan` / `ecc:prp-plan` | trước khi code phase |
| Sinh module CRUD từ ERD | Claude trực tiếp (Haiku/Sonnet) | task 🤖 |
| TDD vùng đỏ/vàng | `ecc:tdd-guide` / `ecc:tdd-workflow` | task 🛠️ |
| Build/type lỗi | `ecc:build-fix` (agent `build-error-resolver`) | khi build/CI đỏ |
| Review thường | `ecc:typescript-reviewer` + `ecc:quality-gate` | LIGHT gate |
| Review nhạy cảm | `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` | FULL gate |
| Logic crown-jewel (payroll, permission) | `ecc:santa-method` / `santa-loop` | G3, G12, G6-2 |
| Dọn dead-code/đơn giản hoá | `refactor-cleaner` / `/simplify` | bước CLEAN |
| Migration DB | `ecc:database-migrations` | mọi đổi schema |
| Test isolation đa-tenant | custom `rls-tenant-isolation-tester` | sau mỗi đổi RLS/repo |
| E2E luồng chính | `ecc:e2e-runner` | cuối mỗi phase |
| Theo dõi chi phí + chọn model | `ecc:cost-tracking` / `ecc:model-route` | mỗi phiên |
| Kiểm tra harness định kỳ | `ecc:harness-audit` | cuối G2/G5/G7 |

**Định tuyến model (GX-6):** Haiku → 🤖 CRUD/docs · Sonnet → 🟡 module · Opus → 🔴 spike khó.

---

## 4. Tự động hoá bằng Hook (`.claude/settings.json`)

### Đã wire (PreToolUse — chốt cứng bất biến)
- `guard-secrets.mjs` · `guard-immutability.mjs` · `guard-tenant.mjs` → chặn vi phạm 3 bất biến *trước khi* ghi file.

### Bổ sung theo phase (kích hoạt dần)

| Hook | Sự kiện | Làm gì | Kích hoạt từ | Trạng thái |
| --- | --- | --- | --- | --- |
| **format-on-write** | PostToolUse `Edit\|Write` | prettier/eslint --fix *trên file vừa đổi* | G1 (có repo) | ✅ wired |
| **typecheck-changed** | PostToolUse | `tsc --noEmit` phạm vi gói bị đổi | G1 | ✅ wired |
| **anti-bandaid-guard** | PreToolUse `Edit\|Write` | **chặn** `catch {}` rỗng · `@ts-ignore` · `eslint-disable` · `.skip(`/`.only(` trong test · `// TODO fix` mới ở vùng đỏ | G1-7 | ✅ wired |
| **test-on-stop** | Stop | chạy `pnpm test` (đổi gì test nấy) + báo cáo đỏ/xanh | G2 | ☐ chưa (verify thủ công thay) |
| **regression-tenant** | Stop / sau diff vùng đỏ | chạy lại test isolation 2-tenant | G2-5 | ☐ chưa (int-spec RLS thay) |

> `anti-bandaid-guard` chính là cánh tay ép **root-cause**: nó không cho "tắt đèn báo lỗi", buộc bạn sửa gốc.
> Trạng thái wired thật + GAP các Stop-hook còn lại: xem **§8.1** (GX-8).

---

## 5. Tự kiểm / tự sửa — giao thức ROOT-CAUSE

Khi AUTO-CHECK đỏ, KHÔNG sửa ngay bề mặt. Chạy giao thức:

```text
1. TÁI HIỆN   — chạy lại, đọc full stack/log. Lỗi gì, ở đâu, input nào?
2. KHOANH VÙNG — bug ở code mới hay lộ bug cũ? Diff gần nhất là nghi can số 1.
3. HỎI "VÌ SAO" ~3 lần — đi từ triệu chứng tới nguyên nhân gốc (5-whys rút gọn).
4. SỬA GỐC     — sửa đúng nguyên nhân, không nới điều kiện cho qua test.
5. CHỨNG MINH  — test cũ xanh lại + thêm 1 test bắt đúng ca lỗi này (chống tái phát).
6. RÀ LAN      — regression suite. Fix có làm hỏng chỗ khác không?
─ Hộp dừng: quá 2 vòng chưa ra gốc → GHI lại giả thuyết đã thử + HỎI người. Không đoán mò chồng fix.
```

**Vòng tự sửa build/test tự động** (vùng xanh/vàng): `ecc:build-fix` lặp build→đọc lỗi→sửa tối thiểu→build cho tới xanh, mỗi vòng tôn trọng giao thức trên. Vùng đỏ: **không** auto-loop — mỗi diff người xem.

---

## 6. Kỷ luật commit & nhánh (bước nhỏ → bước lớn)

```text
main ──────────────●───────────────────●──────▶   (chỉ nhận merge khi cụm xanh + gate đạt)
                   ▲                    ▲
feat/G4-approval   │ squash/merge       │
   ●─●─●─●─●───────┘                    │
   micro-commits (mỗi bước mục 1)       │
feat/G4-tasks  ●─●─●──────merge─────────┘  (nhánh độc lập, chạy song song được)
```

- **Micro-commit:** mỗi bước mục 1 = 1 commit. Conventional: `feat(approval): ...` / `fix(rls): ...` / `test(payroll): ...` / `refactor: ...`. Tham chiếu mã task: `feat(G4-5): approval 1 cấp + return revision`.
- **Nhánh theo feature/phase:** không commit thẳng `main`. 1 nhánh = 1 cụm task liên quan.
- **Merge bước lớn:** khi cả cụm xanh + gate (LIGHT/FULL theo vùng) đạt → squash hoặc merge. Vùng đỏ: người bấm merge.
- **Commit message:** theo `git-workflow.md` của bạn (không gắn attribution — đã tắt global). Phân tích cả lịch sử khi mở PR.
- **Mỗi commit phải xanh** (lint+type+test) để `git bisect` được khi cần truy bug.

---

## 7. Chạy SONG SONG (tiết kiệm thời gian)

### Nên song song (độc lập, không đụng nhau)
- **Module CRUD khác domain** cùng phase: vd G5 (org/team/position/employee) — mỗi module 1 nhánh, sinh song song. Solo + AI: bạn duyệt lần lượt, AI sinh đồng thời.
- **Các chiều review** trên cùng 1 diff: security ‖ database ‖ silent-failure chạy song song rồi gộp.
- **Verify nhiều giả thuyết bug** cùng lúc.

### Cô lập khi song song có ghi file
- Dùng **git worktree** cho mỗi nhánh chạy song song có sửa file → không đạp lên nhau (`isolation: worktree`).

### KHÔNG song song
- Đổi **schema/migration** dùng chung (thứ tự + backfill `company_id` phải tuần tự — GX-4).
- Lõi chung (`withTenant`, `PermissionService`, outbox) — một nguồn sự thật, sửa tuần tự.
- Vùng đỏ nhiều việc cùng lúc — quá tải kiểm soát rủi ro cho người solo.

> Cơ chế: dùng **parallel agents** (review đa chiều) hoặc một **Workflow** (fan-out module CRUD → review → verify) khi bạn muốn. _Workflow tốn nhiều token — chỉ chạy khi bạn yêu cầu rõ._

---

## 8. Kích hoạt dần theo phase (đừng bật hết một lúc)

| Mốc | Bật cái gì | Trạng thái (2026-06-16) |
| --- | --- | --- |
| **G0 (giờ)** | Playbook này + 3 guard hook (đã có). Định tuyến model thủ công. | ✅ + **nâng cấp**: định tuyến model giờ **TỰ ĐỘNG** (`CLAUDE.md §6`, không còn thủ công) |
| **G1** | CI (lint+type+test) · format-on-write · typecheck-changed · anti-bandaid-guard · nhánh+conventional commit. | ✅ tất cả wired (`.claude/settings.json` + `.github/workflows/`) |
| **G2** | test-on-stop · regression-tenant · FULL gate cho mọi diff RLS/audit/secret. | ⚠️ FULL gate ✅ (nhiều lane); **`test-on-stop` + `regression-tenant` CHƯA wire dạng hook** — thay bằng verify DB-cô-lập thủ công mỗi lane (xem gap §8.1) |
| **G3+** | santa-method cho permission · vòng tự-sửa build-fix cho vùng xanh. | ✅ santa dùng G3/G6-2/G12/G16-1a · build-fix dùng trong lane |
| **G5+** | song song module CRUD (worktree) · review đa chiều song song. | ✅ workflow `parallel-lanes` + worktree (dùng nhiều) |
| **G2/G5/G7** | `ecc:harness-audit` rà toàn bộ harness. | ✅ chạy GX-5 (`docs/ops/harness-audit-2026-06-16.md`, 25/29) |

### 8.1 Trạng thái kích hoạt chi tiết + GAP còn lại (GX-8)

> Rà thật theo `.claude/settings.json` của dự án (cây `feat/gx-ops`, off master `10acafb`). Doc-only.

**✅ ĐÃ BẬT (wired thật trong `.claude/settings.json`):**

- **PreToolUse** `Write|Edit|MultiEdit` → `guard-secrets` · `guard-immutability` · `guard-tenant`
  (3 bất biến) + `anti-bandaid-guard` (chặn `catch{}` rỗng / `@ts-ignore` / `eslint-disable` /
  `.skip`/`.only` / TODO-fix vùng đỏ) + `guard-migration-band` (chặn migration ngoài band lane).
- **PostToolUse** `Write|Edit|MultiEdit` → `format-on-write` (prettier/eslint --fix) · `typecheck-changed`.
- **FULL/LIGHT gate phân tầng** (`CLAUDE.md §6`) · **định tuyến model tự động** (`parallel-lanes`) ·
  **santa-method** crown-jewel · **parallel-lanes + worktree** · **conventional commit** · **CI** (`.github/workflows/`).

**☐ GAP CÒN LẠI (chưa kích hoạt — backlog, không chặn GX-8):**

| Gap | Playbook ref | Hiện trạng / giảm thiểu | Bật khi nào |
| --- | --- | --- | --- |
| `test-on-stop` (Stop hook chạy `pnpm test` đổi-gì-test-nấy) | §4, §8 G2 | CHƯA wire dạng hook. Giảm thiểu: verify DB-cô-lập thủ công mỗi lane (`scripts/lane-db-setup.sh` + `LANE_DB`) + CI. | khi muốn ép test mỗi lần Stop |
| `regression-tenant` (Stop / sau diff vùng đỏ → test isolation 2-tenant) | §4, §8 G2 | CHƯA wire dạng hook. Giảm thiểu: int-spec RLS isolation chạy trong verify + `rls-coverage-assert` (GX-4, g2rls). | cùng `test-on-stop` |
| `require-plan` (PreToolUse chặn Write code khi thiếu `docs/plans/<phase>*.md`) | §11 (tuỳ chọn) | Tuỳ chọn, CHƯA bật. Giảm thiểu: cổng PLAN-FIRST giữ bằng kỷ luật + planner crown. | nếu muốn ép cứng plan-first |
| `evals/` fixtures + `SECURITY.md` | harness-audit gap | 2 gap từ harness-audit 25/29 (doc/cấu trúc, không phải lỗ hổng runtime). | backlog G-security |

> **Đánh giá:** lõi tự-động-hoá (3 guard bất biến + anti-bandaid + format/typecheck + gate phân tầng +
> routing tự động + parallel-lanes) đã BẬT và dùng xuyên suốt G1→G16. Gap còn lại là các **Stop-hook
> tiện lợi** (`test-on-stop`/`regression-tenant`) đang được thay bằng verify thủ công per-lane, và 2
> hạng mục doc — đều backlog, không chặn đóng GX-8.

---

## 9. Cái KHÔNG nên tự động (giới hạn trung thực)

- **Sửa mù vùng đỏ** (permission/payroll/RLS/secret) — luôn người chốt.
- **Migration phá huỷ dữ liệu** — review tay + drill restore.
- **Đổi test để qua bug** — cấm tuyệt đối (anti-bandaid-guard chặn).
- **Auto-merge vào `main`** — `main` luôn cần chốt người + CI xanh.
- **Quyết định kiến trúc** (đổi ADR) — đó là việc người, ghi ADR mới.

---

## 11. CỔNG PLAN-FIRST (bắt buộc — không plan, không viết code)

> Luật cứng: **trước khi gõ dòng code đầu tiên của một phase/feature, PHẢI có file plan đã được rà soát rủi ro.**

```text
1. TẠO PLAN   — copy docs/plans/_TEMPLATE.md → docs/plans/<mã>-<tên>.md (vd G4-5-approval.md).
                Điền: mục tiêu · scope in/out · vùng rủi ro mỗi bước · phân rã micro-step ·
                bước nào song song được · agent/skill/model mỗi bước · test plan (deny-path trước) · rollback.
2. RÀ SOÁT    — chạy agent `plan-reviewer` (đối kháng): tìm phụ thuộc thiếu, rủi ro 3 bất biến,
                thứ tự nguy hiểm (backfill trước RLS?), scope creep, thiếu rollback.
3. SỬA PLAN   — vá tới khi plan-reviewer trả PASS. Plan tệ = code tệ.
4. MỚI CODE   — sang vòng lặp micro-step (mục 1). Plan là hợp đồng của phase.
```

- Plan nhỏ (1 task 🟢) → plan ngắn vài dòng cũng được, nhưng **vẫn phải có file**.
- Phát sinh lệch plan giữa chừng → cập nhật file plan + ghi lý do, không âm thầm đi lệch.
- _Tuỳ chọn:_ hook `require-plan` (PreToolUse) chặn Write code khi chưa có `docs/plans/<phase>*.md` — bật ở G1-7 nếu muốn ép cứng.

---

## 12. ĐÁNH GIÁ CHẤT LƯỢNG & HOÀN THÀNH (completion gate)

> Mỗi **bước lớn/phase** đóng lại bằng đánh giá có điểm, không đóng theo cảm tính.

Chạy agent `completion-evaluator` → chấm theo rubric, trả **PASS / BLOCK**:

| Chiều | Hỏi gì | Trọng số |
| --- | --- | --- |
| **Correctness** | Đúng acceptance của PRD/plan? Luồng chính chạy? | 25% |
| **Bất biến & bảo mật** | `company_id` mọi query? secret mã hoá? append-only? vùng đỏ qua FULL gate? | 30% |
| **Test** | Deny-path có trước? coverage ≥80% (riêng permission/payroll cao hơn)? regression xanh? | 25% |
| **Sạch sẽ** | Không dead-code mới? không vá triệu chứng? file <800 dòng? | 10% |
| **Docs/Audit** | Audit log hành động quan trọng? TASKS.md/plan cập nhật? | 10% |

- **DoD (CLAUDE.md mục 8) là điều kiện cứng** — thiếu 1 mục = BLOCK, không cộng điểm bù.
- Vùng đỏ: BLOCK nếu thiếu bất kỳ test deny-path hoặc FULL gate.
- Kết quả ghi vào cuối file plan (mục "Kết quả đánh giá").

---

## 13. CUSTOM SKILL & AGENT của dự án

**Tạo ngay (không cần codebase):**

| Tên | Loại | Vai trò | Vị trí |
| --- | --- | --- | --- |
| `plan-reviewer` | agent | Rà soát plan đối kháng trước khi code (mục 11) | `.claude/agents/plan-reviewer.md` |
| `completion-evaluator` | agent | Chấm hoàn thành + chất lượng (mục 12) | `.claude/agents/completion-evaluator.md` |

**Tạo đúng phase (cần ngữ cảnh code — đừng tạo sớm):** xem bảng "Custom components" trong [`TASKS.md`](../TASKS.md) — `workflow-statemachine-designer/-tester` (G4/G7), `secret-encryption-reviewer` (G6-2), `payroll-snapshot-immutability-guard` (G12), `rls-tenant-isolation-tester` (G2-5), `realtime-test-harness` (G10), `event-outbox-audit-guide` (G2-4)…

> Nguyên tắc: custom component phụ thuộc code **chỉ tạo khi tới phase đó**. Tạo sớm = đoán mò = chất lượng kém, ngược với chính nguyên tắc root-cause.

---

## 14. TỰ CHỌN MODEL theo việc (GX-6)

| Vùng / việc | Model | Vì sao |
| --- | --- | --- |
| 🟢 CRUD, docs, format, fix lint | **Haiku** | rẻ, đủ dùng, gọi nhiều |
| 🟡 module logic thường, review thường | **Sonnet** | cân bằng |
| 🔴 permission, workflow FSM, payroll, ADR, plan-review, completion-eval | **Opus** | suy luận sâu, rủi ro cao |

- **Cơ chế:** khi orchestrate, mỗi sub-agent/bước được gán model theo vùng (tham số `model` của Agent / `model:` trong workflow / frontmatter agent). Phân vân → `ecc:model-route` gợi ý. Chi phí → `ecc:cost-tracking`.

---

## 15. QUẢN LÝ SESSION & CONTEXT ("tự mở session mới" — bản trung thực)

"Tự động mở session mới vô hạn không người" **không tồn tại**. Đây là các cơ chế thật để giữ chạy liên tục:

| Nhu cầu | Cơ chế | Ghi chú |
| --- | --- | --- |
| Context sắp đầy | Compaction tự động (harness) · `ecc:strategic-compact` chủ động | Tóm tắt rồi tiếp, không mất việc |
| Sang phase mới / hôm sau | `ecc:save-session` cuối phiên → `ecc:resume-session` đầu phiên kế | Session mới nhưng giữ ngữ cảnh |
| Việc lặp/định kỳ tự chạy | `schedule` (cron remote agent) · `/loop` (tự nhịp) | Hợp cho backup, canary, rà harness |
| Phase nhiều bước độc lập | Workflow fan-out (nhiều agent) | Tốn token — chỉ khi bạn yêu cầu |

> Giới hạn: tự động hoá session = **giữ liên tục + lập lịch + nối ngữ cảnh**, KHÔNG phải bỏ mặc tự chạy. Vùng đỏ luôn cần người chốt (mục 2).

---

## 10. Tóm tắt 1 dòng

> Bước nhỏ · test trước (vùng đỏ) · check tự động · đỏ thì truy gốc đừng vá · sạch rồi commit · regression rồi mới sang bước kế · độc lập thì song song · **vùng đỏ luôn có người chốt.**

---

_Liên quan: [`CLAUDE.md`](../CLAUDE.md) · [`TASKS.md`](../TASKS.md) · [`.claude/settings.json`](../.claude/settings.json) · `CLAUDE-CODE-TOOLKIT.md` (bản đồ agent/skill/hook + đặc tả custom component)._
