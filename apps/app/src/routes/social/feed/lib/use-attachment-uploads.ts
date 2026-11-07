/**
 * S16-SOCIAL-FE-2D (plan §4 A4) — khay đính kèm của ô soạn bài/bình luận: chọn → kiểm trần → tải TUẦN TỰ
 * (`uploadSocialAttachment`: 054 → PUT → 055) → `fileId` cho DTO.
 *
 * ┌─ 🔴 NĂM LUẬT, MỖI LUẬT MỘT CA GHIM ──────────────────────────────────────────────────────────────┐
 * │ 1. Vòng tải đọc lại tập ô SỐNG trước MỖI lượt (`itemsRef`) — ô bị gỡ khi còn xếp hàng KHÔNG BAO   │
 * │    GIỜ được khởi động (U2): tải nó là đẩy một tệp người dùng đã bỏ lên storage.                    │
 * │ 2. Mỗi ô một `AbortController`; gỡ ô đang tải ⇒ huỷ đúng lượt đó.                                 │
 * │ 3. `clear(ids)` CHỈ gỡ các tệp đã vào DTO (U1) — đường dọn sau khi gửi xong; `reset()` (huỷ hết + │
 * │    thu hồi hết) CHỈ cho unmount và cổng lật (khoá bình luận / mất quyền — owner ký D10 (a)).       │
 * │ 4. Tháo cây ⇒ huỷ mọi lượt đang bay; `isMountedRef` chặn `setState` sau unmount.                  │
 * │ 5. «Thử lại» KIỂM LẠI trần như một lượt chọn mới (G1) — ô lỗi không tính vào trần nên chỗ của nó  │
 * │    có thể đã bị tệp khác lấp; đưa thẳng về hàng đợi là vượt trần.                                 │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Blob URL xem trước đi qua `useAttachmentPreviews` của CHAT (sổ thu hồi DUY NHẤT — chỉ IMPORT, không chép).
 * `add`/`remove`/`retry`/`clear`/`reset` ỔN ĐỊNH (`useCallback`) để làm deps của effect ở ô soạn.
 */
import * as React from "react";
import { uploadSocialAttachment, type SocialFileTarget } from "@mediaos/web-core";
import { useAttachmentPreviews } from "@/components/chat/composer/use-attachment-previews";
import {
  attachmentKindOf,
  attachmentSubmitState,
  attachmentUploadErrorReason,
  planAttachmentAdds,
  type AttachmentItem,
  type AttachmentRejection,
  type AttachmentSubmitState,
} from "./attachment-draft";

export interface UseAttachmentUploadsOptions {
  /** `post` ⇒ 054/055 hỏi `create:feed-post`; `comment` ⇒ `create:feed-comment`. */
  target: SocialFileTarget;
}

export interface AttachmentUploads {
  items: readonly AttachmentItem[];
  /** Tệp bị từ chối ở lượt chọn — hoặc lượt «Thử lại» — gần nhất (trước khi tải); rỗng ⇒ không báo gì. */
  rejections: readonly AttachmentRejection[];
  submitState: AttachmentSubmitState;
  add: (files: FileList | readonly File[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  /** Gỡ ĐÚNG các ô có `fileId` thuộc `fileIds` (đường dọn sau khi gửi xong). */
  clear: (fileIds: readonly string[]) => void;
  /** Huỷ mọi lượt đang bay + thu hồi mọi xem trước + dọn khay. CHỈ cho cổng lật / unmount. */
  reset: () => void;
}

/** Tham chiếu ỔN ĐỊNH cho «rỗng» — đặt lại cùng tham chiếu thì React bỏ qua lượt render. */
const NO_ITEMS: readonly AttachmentItem[] = [];
const NO_REJECTIONS: readonly AttachmentRejection[] = [];

let localSeq = 0;
const nextLocalId = (): string => {
  localSeq += 1;
  return `attach-${localSeq}`;
};

export function useAttachmentUploads({ target }: UseAttachmentUploadsOptions): AttachmentUploads {
  const previews = useAttachmentPreviews();
  const [items, setItems] = React.useState<readonly AttachmentItem[]>(NO_ITEMS);
  const [rejections, setRejections] = React.useState<readonly AttachmentRejection[]>(NO_REJECTIONS);

  /** Nguồn sự thật cho vòng tải (đọc ĐỒNG BỘ giữa các lượt) — `items` chỉ là bản để render. */
  const itemsRef = React.useRef<readonly AttachmentItem[]>(NO_ITEMS);
  const controllersRef = React.useRef(new Map<string, AbortController>());
  const pumpingRef = React.useRef(false);
  const isMountedRef = React.useRef(true);

  const commit = React.useCallback((next: readonly AttachmentItem[]) => {
    itemsRef.current = next;
    if (isMountedRef.current) setItems(next);
  }, []);

  const patchItem = React.useCallback(
    (id: string, patch: Partial<AttachmentItem>) => {
      commit(itemsRef.current.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    },
    [commit],
  );

  const pump = React.useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      for (;;) {
        // Luật 1: đọc lại tập ô SỐNG trước mỗi lượt — ô đã gỡ không còn ở đây.
        const next = itemsRef.current.find((i) => i.status === "queued");
        if (!next || !isMountedRef.current) break;

        const controller = new AbortController();
        controllersRef.current.set(next.id, controller);
        patchItem(next.id, { status: "uploading", error: null });
        try {
          const done = await uploadSocialAttachment(next.file, target, {
            signal: controller.signal,
          });
          if (itemsRef.current.some((i) => i.id === next.id)) {
            patchItem(next.id, { status: "done", fileId: done.fileId });
          }
        } catch (err) {
          // Ô đã bị gỡ/huỷ (abort) ⇒ không còn trong khay, không có gì để báo. Còn ⇒ báo ĐÚNG lý do.
          if (itemsRef.current.some((i) => i.id === next.id)) {
            patchItem(next.id, { status: "error", error: attachmentUploadErrorReason(err) });
          }
        } finally {
          controllersRef.current.delete(next.id);
        }
      }
    } finally {
      pumpingRef.current = false;
    }
  }, [patchItem, target]);

  const add = React.useCallback(
    (files: FileList | readonly File[]) => {
      const plan = planAttachmentAdds(itemsRef.current, Array.from(files));
      setRejections(plan.rejected);
      if (plan.accepted.length === 0) return;
      const added = plan.accepted.map((file): AttachmentItem => {
        const id = nextLocalId();
        const kind = attachmentKindOf(file.type);
        return {
          id,
          file,
          name: file.name,
          sizeBytes: file.size,
          kind,
          status: "queued",
          fileId: null,
          previewUrl: previews.create(id, file, kind === "image"),
          error: null,
        };
      });
      commit([...itemsRef.current, ...added]);
      void pump();
    },
    [commit, previews, pump],
  );

  /** Gỡ một tập ô: huỷ lượt đang bay của chúng + thu hồi xem trước. */
  const drop = React.useCallback(
    (shouldDrop: (item: AttachmentItem) => boolean) => {
      const keep: AttachmentItem[] = [];
      for (const item of itemsRef.current) {
        if (!shouldDrop(item)) {
          keep.push(item);
          continue;
        }
        controllersRef.current.get(item.id)?.abort();
        controllersRef.current.delete(item.id);
        previews.revokeOne(item.id);
      }
      commit(keep);
    },
    [commit, previews],
  );

  const remove = React.useCallback((id: string) => drop((i) => i.id === id), [drop]);

  const clear = React.useCallback(
    (fileIds: readonly string[]) => {
      const sent = new Set(fileIds);
      drop((i) => i.fileId !== null && sent.has(i.fileId));
      setRejections(NO_REJECTIONS);
    },
    [drop],
  );

  const retry = React.useCallback(
    (id: string) => {
      const failed = itemsRef.current.find((i) => i.id === id && i.status === "error");
      if (!failed) return;
      // Luật 5: ô lỗi KHÔNG tính vào trần (`planAttachmentAdds`) ⇒ trong lúc nó nằm lỗi, chỗ của nó có thể
      // đã bị tệp khác lấp. Kiểm lại như một lượt chọn MỚI; bị từ chối ⇒ ô GIỮ lỗi + báo lý do (gỡ bớt rồi
      // thử lại) — không thì 12 tệp ⇒ 400 vô danh, 11 ảnh ⇒ 422 (FULL gate lượt 1, G1).
      const plan = planAttachmentAdds(itemsRef.current, [failed.file]);
      setRejections(plan.rejected.length > 0 ? plan.rejected : NO_REJECTIONS);
      if (plan.accepted.length === 0) return;
      patchItem(id, { status: "queued", error: null });
      void pump();
    },
    [patchItem, pump],
  );

  const abortAll = React.useCallback(() => {
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
  }, []);

  /**
   * Cổng lật chạy lệnh này MỖI lần effect của ô soạn chạy (kể cả lúc mount khi thiếu quyền) ⇒ khay đã
   * rỗng thì KHÔNG đặt state mới (mảng rỗng mới = một lượt render thừa).
   */
  const reset = React.useCallback(() => {
    abortAll();
    previews.revokeAll();
    if (itemsRef.current.length > 0) commit(NO_ITEMS);
    setRejections(NO_REJECTIONS);
  }, [abortAll, commit, previews]);

  // Luật 4. Gán lại `true` trong thân effect: `<StrictMode>` chạy cleanup rồi mount lại một lần.
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortAll();
    };
  }, [abortAll]);

  const submitState = React.useMemo(() => attachmentSubmitState(items), [items]);

  return { items, rejections, submitState, add, remove, retry, clear, reset };
}
