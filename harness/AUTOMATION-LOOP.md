# Vòng tự động end-to-end — MediaOS (mô hình 3 ĐỘI)

> Driver vòng-ngoài theo **3 đội chuyên trách + vòng phản hồi**, KHÔNG chia việc theo "màu" (mọi việc đều phải qua kiểm tra):
> **Đội 1 phân tích & lập kế hoạch → Đội 2 thực thi → Đội 3 kiểm tra & review → PASS: đánh dấu xong / FAIL: trả về Đội 1**, LẶP tới khi hết việc, kèm **tự phục hồi**.
> Thực thi: [`.claude/workflows/auto-loop.mjs`](../.claude/workflows/auto-loop.mjs) (gọi qua Workflow tool). Bản tĩnh "đang ở đâu": `docs/STATUS.md`. Trực quan: `pnpm dashboard`.

## Sơ đồ

```text
        ┌──────────────────── auto-loop (LẶP tới khi hết READY / cạn budget·round) ────────────────────┐
        │                                                                                              │
  ĐỘI 1 ─ PHÂN TÍCH & KẾ HOẠCH ──tasks(impl + TEST + nghiệm thu)──▶ ĐỘI 2 ─ THỰC THI ──xong──▶ ĐỘI 3 ─ KIỂM TRA & REVIEW
   tech-lead + project-analyst                                       builder (db nối tiếp)    completion-eval + qa + (security)
   phân rã bước nhỏ                                                  RED→GREEN→build-fix       đối chiếu nghiệm thu + chạy test
   + tạo task kiểm thử                                               commit wip                ┌── PASS ─▶ ⑥ SHIP (đánh dấu xong)
        ▲                                                                                      │            deploy-gate auto-merge
        │  ⑤ Re-analyze: tìm hướng xử lý → tạo task sửa                                         └── FAIL ─┐
        └──────────────────── trả problem + "thiếu gì" về Đội 1 ◀────────────────────────────────────────┘
                                         (vòng phản hồi tối đa maxReviewIterations rồi giao NGƯỜI)

  TRỢ LÝ (xuyên suốt): progress-tracker đóng dấu start/finish (thời gian thật) · project-analyst cập nhật report
   Kết: dừng-có-trạng-thái → { merged:[], waitingHuman:[PR chờ review], needsHuman:[build kẹt/FAIL hết vòng], report }
```

## Ba đội → cơ chế thật

| Đội | Trách nhiệm | Agent | Đầu ra |
| --- | --- | --- | --- |
| **① Phân tích & Kế hoạch** | Đọc `backlog.mjs` + **`docs/README.md` (chỉ mục §8 → SPEC·DB·API·BACKEND·FRONTEND·QA·adr khớp module, KHÔNG chỉ docs/spec/)** + `DECISIONS-02`; theo trích dẫn §mục trong `done_when`; chọn 1 WO READY (todo && deps done); phân rã bước nhỏ + lane (theo **DOMAIN**, không màu); **kèm tiêu chí nghiệm thu + task kiểm thử (từ QA-\*)**. Nhận FAIL → tìm hướng xử lý → tạo task sửa | `tech-lead` (+ `project-analyst`) | `lanes[]` · `steps[]` · `acceptanceChecks[]` · `testTasks[]` |
| **gác kế hoạch** | Duyệt kế hoạch trước khi code (chỉ lane nhạy cảm): thiếu deny-path test? nghiệm thu đo được? thứ tự migration an toàn? | `plan-reviewer` | PASS / BLOCK |
| **② Thực thi** | Thấy task là làm: viết test RED-trước (việc nhạy cảm) → implement GREEN → build-fix. Commit `wip(...)`. Builder chọn theo domain (db→`db-migration` nối tiếp · FE→`frontend-builder` · BE→`backend-builder`) | `db-migration` · `backend-builder` · `frontend-builder` | `status: committed \| needs_human \| dropped` |
| **③ Kiểm tra & Review** | Code xong → đối chiếu kết quả với **nghiệm thu Đội 1 đặt ra** + chạy test thật. Chạy SONG SONG, **PASS iff tất cả PASS** | `completion-evaluator` + `qa-test-engineer` + (`security-reviewer` nếu nhạy cảm, else `code-reviewer`) | `verdict: PASS \| FAIL` + `failures[]` |
| **⑤ Vòng phản hồi** | FAIL → `failures[]` về **Đội 1** re-analyze → `fixLanes[]` → Đội 2 build lại. Tối đa `maxReviewIterations` vòng rồi giao người | `tech-lead` | `fixLanes[]` |
| **⑥ Ship** | PASS → ledger done + branch + commit + push + `gh pr create` + auto-merge | `deploy-gate` | `merged \| pr_opened \| blocked_protection \| committed` |
| **Trợ lý** | Đóng dấu thời gian (start/finish) + cập nhật tiến độ | `progress-tracker` (+ `project-analyst`) | sổ `harness/activity.jsonl` |

## KHÔNG còn chia theo màu — "nhạy cảm" chỉ làm review SÂU hơn

Mọi WO đều đi qua **đủ 3 đội** (việc nào cũng phải check). Việc **nhạy cảm** (permission · RLS · secret · audit · auth · migration · workflow/FSM phê duyệt) KHÔNG bị chặn lại cho người như trước — thay vào đó tự động được:

- **model mạnh hơn** (Opus cho lane build nhạy cảm),
- **gác kế hoạch** `plan-reviewer` trước khi code,
- **review SÂU hơn** ở Đội 3 (+ `security-reviewer` FULL gate, + `qa-test-engineer`).

→ Quyết "đạt/không đạt" là của **Đội 3 review**, không phải của một nhãn màu đoán-trước.

## Cổng an toàn cố định (KHÔNG bao giờ tự vượt)

1. **3 BẤT BIẾN CLAUDE.md §2** (company_id mọi query · RLS+FORCE trước backfill · audit append-only · không secret plaintext) — do **hook** trong `.claude/hooks/` ép tự động, loop không thể bỏ.
2. **Lights-out merge degrade TRUNG THỰC.** `autoMerge` cố `gh pr merge --squash --auto`. Nếu branch protection của base (vd `master`) yêu cầu **1 review NGƯỜI** → loop KHÔNG ép: để PR + nhãn `auto-merge`, trả `blocked_protection` (KHÔNG báo `merged` khi chưa merge). Khi nào nới rule / đổi `mergeBase` sang nhánh không-protection thì nó lights-out thật.

> ⇒ "Tự động đến khi xong" = loop dọn việc tới mức **đã merge** (nơi rule cho phép) hoặc **PR sẵn-sàng-merge** (nơi rule cần người). Không bao giờ phá bất biến.

## Cách chạy (qua Workflow tool)

```bash
# 1) XEM TRƯỚC an toàn (mặc định — KHÔNG mutate): in hàng đợi "đội nào làm gì"
Workflow{ name:'auto-loop' }                          # dryRun=true mặc định

# 2) CHẠY THẬT (Đội1→2→3, PASS→auto-merge vào nhánh wave; FAIL→re-analyze tới maxReviewIterations)
Workflow{ name:'auto-loop', args:{ dryRun:false } }

# 3) Tham số
Workflow{ name:'auto-loop', args:{ dryRun:false, maxRounds:4, maxReviewIterations:3, maxRetry:2 } }

# 4) Đổi đích merge / tắt lights-out
Workflow{ name:'auto-loop', args:{ dryRun:false, mergeBase:'master' } }      # cần người merge (protection)
Workflow{ name:'auto-loop', args:{ dryRun:false, autoMerge:false } }         # chỉ mở PR, không auto-merge
```

| arg | mặc định | nghĩa |
| --- | --- | --- |
| `dryRun` | `true` | chỉ phân tích + in kế hoạch đội, KHÔNG implement/commit/push/merge |
| `autoMerge` | `true` | lights-out: Đội 3 PASS → auto-merge (degrade `blocked_protection` nếu base cần người) |
| `mergeBase` | `feat/foundation-wave1` | nhánh đích auto-merge (đặt nhánh tích hợp wave để lights-out không vướng protection master) |
| `maxRounds` | `8` | trần số Work Order xử lý/lần chạy |
| `maxReviewIterations` | `3` | trần số vòng phản hồi Đội3→Đội1 cho 1 WO trước khi giao người |
| `maxRetry` | `2` | số lần self-heal retry mỗi lane build trong 1 vòng |
| `only` | — | regex lọc id WO (vd `^FOUNDATION-BE`) |

## Quan hệ với phần khác

- **1 WO/round (tuần tự, cùng cây).** Cần fan-out song song NẶNG cho 1 WO → ủy cho [`parallel-lanes.mjs`](../.claude/workflows/parallel-lanes.mjs) (git worktree riêng mỗi lane).
- Nguồn việc: `backlog.mjs` → `gen-status.mjs`/`docs/STATUS.md`. Trực quan + rủi ro: `pnpm dashboard` + agent `project-analyst`.
- Đội + routing: `harness/team.md` · `harness/policy.md`. Đóng dấu thời gian: `harness/ledger.mjs`.
