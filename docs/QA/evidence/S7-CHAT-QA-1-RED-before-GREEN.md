# S7-CHAT-QA-1 — bằng chứng RED-trước-GREEN (đột biến có kiểm soát)

> `done_when` của WO đòi: *"§20 ca 5 · 9 · 10 · 11 · 12 chạy THẬT, **bằng chứng RED trước GREEN**"*.
>
> **Vì sao cần tài liệu này.** 273 ca xanh không chứng minh điều gì nếu chưa ai thử phá vị từ mà chúng
> canh. Test có thể xanh vì hệ thống đúng, mà cũng có thể xanh vì test không chạm tới đường quyết định
> — và hai thứ đó trông giống hệt nhau trong báo cáo (memory `tests-can-pin-a-hole-open` ·
> `reviewers-pass-real-bugs`). Cách phân biệt duy nhất: **tạo trạng thái VI PHẠM thật rồi xem test có
> đỏ không** (memory `vitest-globalsetup-teardown-exits-zero`).

**Phương pháp.** Với mỗi tiêu chí: gỡ ĐÚNG MỘT vị từ ở production code → chạy ca liên quan → phải ĐỎ →
`git checkout --` khôi phục → chạy lại → phải XANH. Đột biến chỉ sống trong cây làm việc, không commit.

- Lane DB: `mediaos_s7qa1` (chain-migrate `0000 → 0541`)
- HEAD lúc đo: `32ccd2a4` + thay đổi của WO này
- Script: `red-proof.sh` (đột biến bằng `sed`, khôi phục bằng `git checkout --`, kiểm cây sạch ở cuối)

---

## Bảng kết quả

| Probe | §20 | Vị từ bị gỡ | File | Ca chạy | RED | GREEN | Kết luận |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P1** | ca 5 + ca 11 | vế membership `activeMembershipJoin(actorUserId)` khỏi `messageReadConditions` | `chat-access.service.ts:363` | `chat-be4-search` (22) + `chat-qa1-scale` (6) | ✅ exit 1 | ✅ exit 0 | **ĐẠT** |
| **P2** | ca 9 | `PermissionGuard` khỏi cả 4 route đọc-vượt | `chat-oversight.controller.ts` | `chat-be7-oversight -t "ca 16"` | ✅ exit 1 | ✅ exit 0 | **ĐẠT** |
| **P3** | ca 10 | ghi audit `recordSuccess` khỏi cả 3 đường đọc-vượt | `chat-oversight.service.ts:115/136/185` | `chat-be7-oversight -t "ca 17"` | ✅ exit 1 | ✅ exit 0 | **ĐẠT** |
| **P4** | ca 12 | `useCanExact` → `useCan` ở cổng màn quản trị | `console/src/lib/chat-oversight-gate.ts` | `console` `nav.spec.ts` | ✅ exit 1 | ✅ exit 0 | **ĐẠT** |

Cây code sau toàn bộ probe: **`git status --porcelain apps/api/src apps/console/src` = rỗng** (chỉ còn
file MỚI của WO này ở trạng thái untracked). Không đột biến nào lọt lại.

---

## P1 — §20 ca 5 + ca 11: ranh giới membership của đường ĐỌC/TÌM KIẾM

Đây là vị từ đắt nhất module: `/chat/search` quét toàn bộ `chat_messages` của tenant rồi mới lọc, nên
mất vế membership là **rò im lặng** — HTTP 200, kết quả trông hợp lý, chỉ là có thêm tin của phòng
người tìm không thuộc.

```diff
- this.activeMembershipJoin(actorUserId),
+ // [RED-PROBE] gỡ vế membership
```

Kết quả: `chat-be4-search` + `chat-qa1-scale` **ĐỎ** (exit 1). Khôi phục → **XANH** (exit 0).

> Probe này phủ **cả ca 5 lẫn ca 11**: `chat-be4-search` ca 9 và `chat-be7-oversight` ca 22 đều đi qua
> đúng vị từ này — đó chính là điều §20 ca 11 khẳng định (*cặp `chat-oversight` KHÔNG mở tìm kiếm*).

## P2 — §20 ca 9: cặp `('view','chat-oversight')`

```diff
- @UseGuards(ChatOversightAuditGuard, PermissionGuard)
+ @UseGuards(ChatOversightAuditGuard)
```

Kết quả: `ca 16` (role thiếu cặp → 403 + 1 dòng audit `Denied`) **ĐỎ**. Khôi phục → **XANH**.

> Ý nghĩa: `PermissionGuard` ở dự án này là **opt-in per-route** — quên `@UseGuards` thì route MỞ cho
> mọi user đã đăng nhập, im lặng (memory `s1-fnd-module-metadata-seed-drift`). Probe chứng minh bộ
> test bắt được đúng lớp hỏng đó, chứ không chỉ bắt "cấu hình sai cặp".

## P3 — §20 ca 10: audit là ĐIỀU KIỆN của đọc-vượt

```diff
- await this.recordSuccess(tx, actor, CHAT_OVERSIGHT_ENDPOINT.ROOM_SEARCH, null, {
+ if (false) await this.recordSuccess(tx, actor, CHAT_OVERSIGHT_ENDPOINT.ROOM_SEARCH, null, {
```
(và 2 chỗ tương tự — `ROOM_DETAIL`, `ROOM_MESSAGES`)

Kết quả: `ca 17` **ĐỎ** với `AssertionError: expected +0 to be 1` — đúng thông điệp mong muốn: đọc-vượt
xảy ra mà **không để lại dấu vết nào**. Khôi phục → **XANH**.

> ⚠️ **Quan sát về cô lập test (đáng ghi lại).** Lần chạy P3 đầu tiên, vế GREEN vẫn ĐỎ dù `git diff`
> đã sạch 0 dòng. Chạy lại **cô lập** thì XANH, và chu trình đầy đủ baseline-XANH → ĐỎ → XANH tái lập
> được. Nguyên nhân không nằm ở đột biến còn sót mà ở **trạng thái lane DB do lần chạy hỏng ngay trước
> để lại** (ca này ĐẾM hàng `audit_logs`). Bài học vận hành: chạy NGAY SAU một lần chạy hỏng có thể đỏ
> oan — **chạy lại cô lập trước khi kết luận** (cùng lớp với memory `vitest-loadfresh-per-scenario-flake`
> · `super-admin-bootstrap-flaky-count`). Log của lần chạy lại: `red-proof-p3.log`.

## P4 — §20 ca 12: cổng FE phải khớp CHÍNH XÁC

```diff
- import { useAuthStore, useCanExact } from "@mediaos/web-core";
- return useCanExact(CHAT_OVERSIGHT_ACTION, CHAT_OVERSIGHT_RESOURCE);
+ import { useAuthStore, useCan } from "@mediaos/web-core";
+ return useCan(CHAT_OVERSIGHT_ACTION, CHAT_OVERSIGHT_RESOURCE);
```

Kết quả: `console` `nav.spec.ts` ca `[crown-deny-path] caps 'view:*' / '*:chat-oversight' → VẪN ẩn`
**ĐỎ**. Khôi phục → **XANH**.

> Ý nghĩa: `useCan` rơi xuống `*:resourceType` → `action:*` → `*:*`. Dùng nó ở đây thì mọi tài khoản
> giữ một grant wildcard sẽ **thấy lối vào màn đọc trộm tin nhắn**, trong khi backend vẫn 403 — và
> "sửa cho hết lỗi" ở WO sau rất dễ đi theo hướng nới quyền (memory
> `capability-allowlist-hides-admin-screens`).

---

## Điều bằng chứng này KHÔNG chứng minh

Bốn probe chứng minh bộ test **có canh** bốn vị từ trên. Chúng **không** chứng minh:

- không còn đường vòng nào khác tới cùng dữ liệu (việc đó là của census `assertMember` là cửa duy nhất
  — `chat-be1-access` ca 14 — và của FULL gate);
- các ca §20 còn lại (1·2·3·4·6·7·8) cắn thật — chúng chưa được đột biến, vì `done_when` chỉ đòi 5 ca.
  Ai muốn mở rộng: thêm probe vào `red-proof.sh`, khuôn đã có sẵn.
