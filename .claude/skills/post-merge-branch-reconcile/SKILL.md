---
name: post-merge-branch-reconcile
description: Đối chiếu và dọn nhánh SAU khi merge PR (nhất là squash-merge). Dùng khi git graph vẽ nhánh thành hai đường, khi người dùng hỏi "sao mấy nhánh này chưa merge / merge nốt đi", khi `gh pr list` rỗng mà nhánh vẫn còn, hoặc trước khi xoá bất kỳ nhánh nào. Phân biệt "đã land" với "còn việc" bằng DIFF NỘI DUNG hai-chấm, không bằng đồ thị commit.
---

# Dọn nhánh sau merge

## Vì sao graph nói dối

`gh pr merge --squash` (mặc định của repo này) gộp N commit thành **một** commit mới trên đích. Nhánh
local vẫn giữ N commit gốc với SHA khác ⇒ git vẽ **hai đường song song** và mọi công cụ dựa trên **đồ thị
commit** đều báo "chưa merge", dù nội dung đã lên 100%:

| Công cụ | Sau squash-merge | Dùng được? |
| --- | --- | --- |
| `git log <target>..<branch>` | liệt kê đủ N commit | ❌ |
| `git branch --merged <target>` | không liệt kê nhánh | ❌ |
| `git diff <target>...<branch>` (**ba** chấm) | diff từ merge-base ⇒ hiện toàn bộ việc nhánh đã làm | ❌ **bẫy chính** |
| `git diff <target> <branch>` (**hai** chấm) | **rỗng** khi đã land | ✅ |

Ba chấm là thứ lừa người nhiều nhất: nó trả lời "nhánh này đã làm gì kể từ lúc rẽ", không phải "đích còn
thiếu gì". Luôn dùng **hai chấm**.

## Thủ tục

```bash
# 1. Prune TRƯỚC — GitHub tự xoá nhánh remote lúc merge, ref local còn sót lại gây báo động giả
git fetch --prune origin

# 2. Với mỗi nhánh nghi ngờ: diff NỘI DUNG hai-chấm với đích (master, hoặc nhánh wave)
git diff --stat origin/master <branch>        # rỗng  ⇒ đã land, xoá được
                                              # có dòng ⇒ CÒN VIỆC THẬT, đọc trước khi làm gì

# 3. Chỉ khi bước 2 rỗng
git branch -D <branch>

# 4. Verify
git branch -a                                  # còn đúng nhánh mong đợi
git rev-list --count origin/master..HEAD       # 0
git rev-list --count HEAD..origin/master       # 0  (nếu khác 0 thì `git pull --ff-only`)
gh pr list --state open --json number --jq 'length'
```

## Bẫy đã dính

- **`git push origin --delete <branch>` báo `remote ref does not exist`** — không phải lỗi. GitHub đã
  xoá nhánh remote lúc merge; máy bạn chỉ đang giữ remote-tracking ref cũ. Sửa bằng `git fetch --prune`,
  đừng retry push.
- **Nhánh còn tồn tại ≠ còn việc.** Kiểm bằng bước 2 rồi mới kết luận, cả khi hỏi lẫn khi trả lời.
- **View của IDE có thể đang stale.** Panel Git Graph hiện chữ "Outdated" thì nó vẽ `origin/master` ở vị
  trí TRƯỚC merge — refresh trước khi tin.

## Cấm

- Xoá nhánh khi diff hai-chấm **không** rỗng.
- Xoá `master`, hoặc nhánh có commit chưa push (`git log origin/<branch>..<branch>` không rỗng).
- **Đổi nhánh khi cây làm việc đang chia sẻ với phiên khác** — `git checkout` dời HEAD của cả worktree,
  commit tiếp theo của họ sẽ rơi nhầm nhánh. Kiểm `git status` + `harness/activity.jsonl` (dòng
  `started` mang `by:sess:*` khác) + `git worktree list` trước; nếu có, chỉ prune + diff (đều read-only),
  hoãn phần xoá.

## Ghi chú

Đây là việc git hygiene, **không** chạm vùng 🔴 — không cần FULL gate. Nhưng nó là thao tác **phá huỷ**
(xoá con trỏ nhánh), nên bước 2 là điều kiện bắt buộc, không phải khuyến nghị.
