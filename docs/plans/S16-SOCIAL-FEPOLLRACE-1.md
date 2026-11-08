# S16-SOCIAL-FEPOLLRACE-1 — huỷ `043` đang bay trước khi ghi kết quả bỏ/rút phiếu/đóng

## Quyết định
- `PollBlock` ghi kết quả `041/042/044` bằng `setQueryData(resultsKey)`; một `043` đã bay từ trước (vd
  `invalidatePostLists` sau lượt thích) về SAU và đè bằng ảnh chụp trước-bỏ-phiếu.
- Vá: `onMutate` của cả ba mutation `await queryClient.cancelQueries({ queryKey: resultsKey })`
  (tiền lệ `use-task-action-mutation.ts`). Một hàm dùng chung `cancelInFlightResults`.
- Không đổi `onError` (vẫn `invalidateQueries` kéo lại 043 sau lỗi) — huỷ chỉ chạm fetch đang bay.

## done_when → test (`PollBlock.spec.tsx`, nhóm «FEPOLLRACE»)
- ĐO TRƯỚC (RED): 3 ca (bỏ phiếu · rút phiếu · đóng) với `043` thứ hai treo, thả số CŨ sau khi mutation xong.
  Trên mã chưa vá: 3 ca đỏ (số cũ / thiếu nhãn «Đã kết thúc») — đã chạy, 3 failed | 23 passed.
- Vá + mutant: bỏ `onMutate` (= trạng thái mã chưa vá) ⇒ cả 3 ca đỏ; có `onMutate` ⇒ 26/26 xanh.

## Nợ
- Không có. `cancelQueries` huỷ mọi 043 đang bay của post này kể cả của chính khối — chấp nhận, kết quả mutation mới hơn.

## Sổ vết (vá review 08/11)
- [LOW] cửa sổ sau `onMutate`, trước khi 041/042/044 về (3 báo cáo trùng gốc): VÁ — `applyResult` giờ `await cancelQueries` NGAY TRƯỚC `setQueryData` (cả 3 mutation). Ca mới «043 BẮT ĐẦU trong lúc mutation đang bay»: đỏ trên mã cũ → xanh.
- [LOW] cửa sổ hẹp còn lại: một `043` bắt đầu sau `cancelQueries` của `applyResult` nhưng trước `setQueryData` — không còn điểm `await` giữa hai lệnh (đồng bộ) nên không có khoảng hở; không vá thêm.
- [LOW] không dùng `enabled: !isPending` — sẽ làm khối ngừng tự tải/đồng bộ khi mutation chậm; huỷ-rồi-ghi đủ.
