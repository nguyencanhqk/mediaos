# MediaOS Harness — cách làm việc có kiểm soát

> Harness = bộ máy biến *"một tính năng"* → *"thay đổi đã verify, đã ghi nhớ, đã commit"*, với người
> chỉ chạm ở các cổng định sẵn. **Harness không làm model thông minh hơn — nó làm đầu ra đáng tin hơn.**
>
> Đọc kèm: [`AGENTS.md`](../AGENTS.md) (contract) · [`policy.md`](policy.md) (luật tự động) · [`../CLAUDE.md`](../CLAUDE.md) (đầy đủ).

## Vòng một phiên (luôn theo)

```
bash harness/init.sh        # MỞ: đang ở đâu · làm gì · sửa ở đâu (đọc handoff + tái sinh STATUS)
   │
   ├─ làm ĐÚNG 1 Work Order (1 item in_progress trong backlog.mjs)
   │     green/yellow → code thẳng với skills đã liệt
   │     red/phức tạp → đẩy vào parallel-lanes (plan→review→escalate)
   │
bash harness/check.sh --quick   # VERIFY (vòng lặp): lint + typecheck NHANH (KHÔNG DB/test) — bớt shell-wait
   │                            #   full (+test): khi ĐÓNG việc · '--all' (+build): pre-merge/vùng đỏ
   │
bash harness/finish.sh      # ĐÓNG: full check (+test) → cập nhật backlog → ghi handoff → (tuỳ) commit-if-safe
```

## 5 mảnh × 6 cơ chế → file thật

| Mảnh | Cơ chế | File |
| --- | --- | --- |
| **Hướng dẫn** | contract slim | `AGENTS.md` → `CLAUDE.md` |
| **Phạm vi** | ① Work Order (làm gì · `paths` · `done_when`) | `harness/backlog.mjs` |
| **Trạng thái** | tự sinh "đang ở đâu" | `harness/gen-status.mjs` → `docs/STATUS.md` |
| **Ghi nhớ** | ② 3 tầng: phiên (TodoWrite) → bàn giao → dài hạn | `harness/handoff.md` · `docs/adr/` |
| **Kiểm chứng** | verify 1 lệnh + 6 hook + CI RLS gate | `harness/check.sh` · `.claude/hooks/` · `.github/workflows/ci.yml` |
| **Vòng đời** | ④ mở/đóng phiên | `harness/init.sh` · `harness/finish.sh` |
| (xuyên suốt) | ③ phân rã→song song→chuyên gia→leo thang · ⑤ routing model/skill | `.claude/workflows/parallel-lanes.mjs` + `policy.md` |
| (xuyên suốt) | guard-scope: chống sửa ngoài `paths` | `.claude/hooks/guard-scope.mjs` (warn-only) |

## Một Work Order trông như

```js
// harness/backlog.mjs
{ id: 'FE-WS-1', title: '…', zone: 'green', status: 'in_progress',
  paths: ['apps/workspace/**', 'apps/studio/**'],   // ◀ SỬA Ở ĐÂU (guard-scope ép)
  skills: ['frontend-design', 'code-review'],        // ◀ DÙNG SKILL NÀO (⑤ tĩnh)
  depends_on: ['HARNESS-SPINE'],
  done_when: ['…'] }                                  // ◀ ĐÍCH HỘI TỤ (verify chứng minh)
```

## Bộ não (đa-agent) nối vào thế nào

`parallel-lanes` (Workflow tool) đã sẵn: `pickModel` (crown→Opus) · `pickReviewers/Skills` ·
pipeline plan→implement→review · crown spawn reviewer độc lập + `santa-method` · `mergeVerdicts`→`needs_human` ·
`dryRun` xem trước. **Ràng buộc thật:** Workflow script không đọc file đĩa → bộ não ở Workflow, spine là
script thường; main-loop nối hai cái (đọc Work Order in_progress → tự làm, hoặc feed vào parallel-lanes).

## Đã build / hoãn

- ✅ **Build**: State · Memory · Session · Work Order bền · guidance slim · policy/routing doc · guard-scope.
- ✅ **Thêm 2026-06-19 (học từ harness-kit Next.js)**: thang kiểm chứng `check.sh --quick/--all` · **Stop-gate** kết-phiên (`stop-gate.mjs`, advisory→block) · **skill-smith** (đóng băng ma sát thành skill) · **auto-merge có kiểm soát** vùng 🟢/🟡 (`auto-merge.yml` + `scripts/setup-github.sh`).
- ⏸ **Hoãn** (gắn sau khi xương chắc, theo đau thật): ⑥ Review-Improve chủ động ·
  scheduled agent (canary/backup/drift) · routing engine động `pickSkills()`.
- ♻️ **Dùng lại nguyên**: 6 hook bất biến · CI RLS gate · `parallel-lanes` · scripts ops (`backup-db`/`canary-watch`/`lane-db-setup`).
