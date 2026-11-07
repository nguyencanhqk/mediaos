/**
 * S7-CHAT-FE-2 → **S17-CHAT-UX2-FE-3** — ô soạn tin (SPEC-15 §14 · §22c CHAT-DEC-027).
 *
 * HAI BẤT BIẾN của file này:
 *
 * 1. `clientMessageId` sinh **MỘT LẦN** khi bắt đầu soạn (nháp từ rỗng → có chữ hoặc có tệp) và giữ
 *    nguyên qua mọi lần bấm "Gửi lại". Sinh mới trong hàm gửi = khoá ngẫu nhiên mỗi lần = **không chống
 *    trùng gì cả** (memory `idempotency-key-must-be-content-derived`).
 * 2. Gửi lỗi **KHÔNG được xoá chữ người dùng đã gõ** (§14). Nháp chỉ bị dọn khi server đã nhận.
 *
 * S17 thêm bốn thứ và KHÔNG được phá hai bất biến trên: gợi ý `@mention`, bảng emoji tĩnh, dán/kéo-thả
 * tệp, và thumbnail xem trước. Ba luật đi kèm:
 *
 * 3. Ô soạn có **ĐÚNG MỘT** `role="textbox"`. Gợi ý mention bám chính `<textarea>` (trigger inline `@`)
 *    chứ không phải một ô tìm riêng — thêm input thứ hai làm đỏ hàng loạt spec đang dùng
 *    `getByRole("textbox")`, và tệ hơn là cắt mạch gõ của người dùng.
 * 4. `mentions[]` gửi lên **suy từ chính chuỗi nháp** (`collectMentionIds`), không phải từ danh sách
 *    tích luỹ theo lượt chọn — xem docblock `use-mention-autocomplete.ts`.
 * 5. Mọi blob URL xem trước sinh ở ĐÂY thì cũng **thu hồi ở đây** (gỡ tệp · gửi xong · tháo cây).
 *
 * S20-CHAT-DRAFT-1 — chữ, bảng mention, khoá idempotency của nháp sống ở `chat-draft.store` (CHỈ bộ
 * nhớ, theo `roomId`) thay vì state cục bộ, để đổi phòng / bấm ⤢ không xoá nháp. Tệp chờ vẫn cục bộ
 * và KHÔNG được giữ — tháo cây khi còn tệp thì để lại cảnh báo cho lần quay lại.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SendHorizontal } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { Button, cn, toast } from "@mediaos/ui";
import type { StoredChatMessage } from "@/stores/chat.store";
import { createClientMessageId } from "@/stores/chat.store";
import {
  CHAT_PAIRS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MENTIONS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
} from "@/routes/chat/constants";
import { uploadPrecheckMessage } from "@/lib/upload-precheck";
import { uploadChatAttachment } from "./chat-upload";
import { EMPTY_CHAT_DRAFT, useChatDraftStore } from "./chat-draft.store";
import {
  applyMention,
  collectMentionIds,
  mentionLabel,
  useMentionAutocomplete,
  type MentionCandidate,
} from "./use-mention-autocomplete";
import { AttachmentPreviewList, type PendingAttachment } from "./composer/AttachmentPreviewList";
import { ComposerActions } from "./composer/ComposerActions";
import { ComposerNotices, type ReplyQuoteState } from "./composer/ComposerNotices";
import { MentionPopover, mentionOptionId } from "./composer/MentionPopover";
import { useAttachmentPreviews } from "./composer/use-attachment-previews";
import { useFileDrop } from "./composer/use-file-drop";
import { useTypingPing } from "./composer/use-typing-ping";

export interface ComposerSubmitPayload {
  clientMessageId: string;
  body: string;
  fileIds: string[];
  /** Đã lọc theo nháp hiện tại; mảng RỖNG khi không nhắc ai (không phải `undefined`). */
  mentions: string[];
  replyToMessageId?: string;
}

interface MessageComposerProps {
  /** Phòng đang mở — khoá của nháp trong `chat-draft.store` (nháp thuộc về phòng). */
  roomId: string;
  isArchived: boolean;
  replyTo: StoredChatMessage | null;
  /** S20-CHAT-FEDEBT-1 — thân trích dẫn của khung «đang trả lời»; xem `ReplyQuoteState`. */
  replyQuote?: ReplyQuoteState;
  onCancelReply: () => void;
  /**
   * S17 — ứng viên gợi ý `@mention`, ĐÃ lọc người còn trong phòng (`rosterToMentionCandidates`).
   * Rỗng ⇒ tính năng tự tắt, không có nhánh riêng nào.
   */
  mentionCandidates?: readonly MentionCandidate[];
  /** Trả `true` khi server đã nhận; `false` ⇒ GIỮ NGUYÊN nháp để bấm "Gửi lại". */
  onSubmit: (payload: ComposerSubmitPayload) => Promise<boolean>;
}

const MENTION_LISTBOX_ID = "chat-mention-listbox";

export function MessageComposer({
  roomId,
  isArchived,
  replyTo,
  replyQuote = "live",
  onCancelReply,
  mentionCandidates = [],
  onSubmit,
}: MessageComposerProps): React.ReactElement {
  const { t } = useTranslation("chat");
  /**
   * MỘT cổng quyền duy nhất cho cả gõ chữ lẫn đính kèm — `S7-CHAT-BE-8`.
   *
   * Trước BE-8, nút đính kèm phải hỏi RIÊNG cặp FOUNDATION `upload:foundation-file` vì đường upload đi
   * qua `/foundation/files/*`; cặp đó chỉ có ở company-admin nên nút biến mất với gần hết công ty. BE-8
   * chuyển đường upload sang `/chat/files/*` gate `send:chat-message` ⇒ ai gửi được tin thì tải được
   * tệp, và hỏi thêm một cặp thứ hai ở FE giờ chỉ ẩn nút của người server sẵn sàng phục vụ.
   */
  const canSend = useCan(CHAT_PAIRS.SEND_MESSAGE.action, CHAT_PAIRS.SEND_MESSAGE.resourceType);

  const roomDraft = useChatDraftStore((s) => s.drafts[roomId] ?? EMPTY_CHAT_DRAFT);
  const draft = roomDraft.text;
  const setText = useChatDraftStore((s) => s.setText);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * `handleSubmit` giữ một `await onSubmit(...)` bay ngang qua ranh giới mạng thật (POST gửi tin). Nếu ô
   * soạn bị THÁO trong lúc đó — đổi phòng, đóng panel nổi, hay (trong test) `cleanup()` unmount sau khi
   * assertion chính đã qua — thì `await` vẫn tiếp tục chạy và cố gọi `setSending(false)` trên một
   * component không còn gắn với cây React nào nữa.
   *
   * Đây KHÔNG phải chuyện vô hại: `dispatchSetState` tính độ ưu tiên cập nhật (`resolveUpdatePriority`)
   * TRƯỚC khi kiểm tra fiber còn gắn hay không, và bước đó đọc `window`. Ở app chạy thật, `window` luôn
   * còn đó nên hậu quả chỉ là một no-op vô hình; ở test, `window` có thể đã bị môi trường jsdom dọn sạch
   * ngay sau khi file test kết thúc — và lúc đó `setSending(false)` ném `ReferenceError`. Chặn TẠI NGUỒN
   * bằng cờ mounted, đừng gọi `setState` cho một cây đã tháo, dù nguyên nhân "đã tháo" là gì.
   *
   * ⚠️ S17: cờ này ở LẠI đây khi tách sub-component. Đẩy nó xuống `composer/**` là mở lại đúng cái bẫy
   * `ismounted-ref-stuck-false-under-strictmode` ở một file mà không ai nhớ vì sao nó tồn tại.
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    // PHẢI gán `true` ở THÂN effect, không chỉ dựa vào giá trị khởi tạo của `useRef`. `<StrictMode>`
    // (main.tsx) chạy effect hai lần ở dev: mount → cleanup → mount. Nếu chỉ có cleanup gán `false`,
    // lần mount thứ hai không khôi phục cờ ⇒ ref kẹt `false` VĨNH VIỄN và `handleSubmit` thoát sớm
    // mãi mãi: spinner không tắt, nháp không xoá, lỗi không hiện — dù cây vẫn đang gắn bình thường.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Khoá idempotency của NHÁP hiện tại — ở store nháp, cấp MỘT lần khi bắt đầu soạn.
   *
   * Không ở state cục bộ: nó phải sống qua mọi lần re-render giữa lúc `onSubmit` đang bay, và (S20) qua
   * cả lần tháo khi đổi phòng — dựng lại mà cấp khoá mới thì «gửi lại» thành một tin KHÁC ở server.
   */
  const ensureClientMessageId = useCallback(
    (): string => useChatDraftStore.getState().ensureClientMessageId(roomId, createClientMessageId),
    [roomId],
  );

  /**
   * Tệp chờ KHÔNG được giữ qua lần tháo (blob xem trước thu hồi cùng cây). Ghi lại SỐ tệp bị bỏ để lần
   * quay lại phòng có cảnh báo. `epoch` chụp lúc dựng: đăng xuất giữa chừng ⇒ store bỏ qua lần ghi trễ.
   */
  const pendingFileCountRef = useRef(0);
  /** S20-CHAT-FEDEBT-1 — tệp của lượt chọn đang chạy CHƯA vào khay (đang tải + chờ tải): cũng bị bỏ. */
  const inFlightFileCountRef = useRef(0);
  /** `t` qua ref: đổi ngôn ngữ không phải lý do để chạy cleanup «ô soạn bị tháo» bên dưới. */
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    pendingFileCountRef.current = attachments.length;
  }, [attachments.length]);
  useEffect(() => {
    const epoch = useChatDraftStore.getState().sessionEpoch;
    return () => {
      // S20-CHAT-FEDEBT-1 — báo NGAY lúc rời (đổi phòng · đóng drawer · ⤢), không đợi quay lại mới biết.
      // Store từ chối lần ghi (đăng xuất giữa chừng · 0 tệp) ⇒ cũng không báo gì.
      const count = pendingFileCountRef.current + inFlightFileCountRef.current;
      if (useChatDraftStore.getState().noteFilesNotKept(roomId, count, epoch)) {
        toast.warning(tRef.current("composer.filesDroppedOnLeave", { count }), {
          key: `chat-files-not-kept:${roomId}`,
        });
      }
    };
  }, [roomId]);
  /** Vị trí con trỏ cần đặt lại SAU khi React vẽ xong `draft` mới (chèn mention / emoji). */
  const pendingCaretRef = useRef<number | null>(null);

  const mention = useMentionAutocomplete(mentionCandidates);
  const previews = useAttachmentPreviews();

  // Đặt lại con trỏ sau khi chèn. `pendingCaretRef` là cổng: mọi lần `draft` đổi vì GÕ đều bỏ qua đây.
  useEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    const el = textareaRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [draft]);

  const disabled = isArchived || !canSend;
  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const tooLong = draft.length > MAX_MESSAGE_LENGTH;

  /** S8-CHAT-UX-FE-3 — ping "đang gõ", tiết lưu leading-edge. Xem `composer/use-typing-ping.ts`. */
  const pingTyping = useTypingPing(roomId, disabled);

  /**
   * ĐƯỜNG DUY NHẤT đưa tệp vào nháp — nút 📎, dán, và kéo-thả đều đi qua đây. Nhân bản luật trần
   * tệp / `ensureClientMessageId` / gộp lỗi ra ba chỗ là ba chỗ để chúng trôi khỏi nhau.
   */
  const handlePickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      useChatDraftStore.getState().clearFilesNotKept(roomId);
      const picked = Array.from(files);
      if (attachments.length + picked.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        setError(t("composer.tooManyFiles", { count: MAX_ATTACHMENTS_PER_MESSAGE }));
        return;
      }
      // S16-SOCIAL-FILEOPENUX-1 — lọc sớm nhóm tệp server LUÔN từ chối (`lib/upload-precheck.ts`). Đặt ở đây vì
      // đây là đường duy nhất của 📎 · dán · kéo-thả; một tệp bị chặn ⇒ cả lượt dừng trước mọi lời gọi API.
      const rejected = picked.map(uploadPrecheckMessage).find((m) => m !== null);
      if (rejected) {
        setError(t(rejected.key, rejected.values));
        return;
      }
      ensureClientMessageId(); // soạn đã bắt đầu ngay khi có tệp, dù chưa gõ chữ nào
      let remaining = picked.length;
      inFlightFileCountRef.current += remaining;
      for (const file of picked) {
        setUploading(file.name);
        try {
          const uploaded = await uploadChatAttachment(file);
          // Cây có thể ĐÃ THÁO trong lúc `await` bay: cleanup của `useAttachmentPreviews` khi đó đã
          // `revokeAll()` xong ⇒ blob URL tạo sau mốc này KHÔNG AI thu hồi được nữa (rò tới khi tải
          // lại trang). Dừng ngay — đừng tạo, đừng `setState`. (Lúc tháo, tệp này đã được tính vào
          // cảnh báo rời phòng qua `inFlightFileCountRef`.)
          if (!isMountedRef.current) return;
          // Xem trước dựng từ CHÍNH `File` người dùng chọn, không đợi URL ký của server: tệp chưa gắn
          // vào tin nào nên chưa có `file_links` để ký, mà người dùng cần thấy ngay mình vừa dán gì.
          const previewUrl = previews.create(uploaded.fileId, file, uploaded.isImage);
          setAttachments((prev) => [...prev, { ...uploaded, previewUrl }]);
          // Chuyển ĐỒNG BỘ từ «đang chờ» sang «trong khay»: tháo trước khi effect kịp chạy vẫn đếm đủ.
          pendingFileCountRef.current += 1;
          inFlightFileCountRef.current -= 1;
          remaining -= 1;
        } catch (err: unknown) {
          // Dừng ở tệp lỗi, GIỮ những tệp đã lên. Bỏ hết là bắt người dùng làm lại từ đầu vì một tệp hỏng.
          setError(t("composer.uploadFailed", { name: file.name }));
          console.error("[chat] tải tệp đính kèm thất bại:", err);
          break;
        } finally {
          setUploading(null);
        }
      }
      // Hết lượt (xong hết, hoặc dừng ở tệp lỗi): phần còn lại của lượt không còn «đang chờ» nữa.
      inFlightFileCountRef.current -= remaining;
    },
    [attachments.length, ensureClientMessageId, previews, roomId, t],
  );

  // Bọc `useCallback`: `useFileDrop` memo theo tham chiếu này — truyền một arrow mới mỗi lần render
  // thì memo bên trong không giữ được gì cả.
  const acceptFiles = useCallback(
    (files: FileList | null) => void handlePickFiles(files),
    [handlePickFiles],
  );
  const fileDrop = useFileDrop(disabled, acceptFiles);

  const removeAttachment = useCallback(
    (fileId: string) => {
      previews.revokeOne(fileId);
      setAttachments((prev) => prev.filter((x) => x.fileId !== fileId));
    },
    [previews],
  );

  const pickMention = useCallback(
    (candidate: MentionCandidate) => {
      const trigger = mention.trigger;
      if (trigger === null) return;
      const next = applyMention(draft, trigger, candidate);
      useChatDraftStore.getState().addMention(roomId, {
        userId: candidate.userId,
        label: mentionLabel(candidate.name),
      });
      setText(roomId, next.text);
      pendingCaretRef.current = next.caret;
      // Đóng NGAY và KHÔNG `sync` lại: con trỏ vừa đứng sau `@Tên ` nên dò trigger sẽ mở lại đúng cái
      // popover mình vừa chọn xong.
      mention.close();
      ensureClientMessageId();
    },
    [draft, ensureClientMessageId, mention, roomId, setText],
  );

  const insertEmoji = useCallback(
    (emoji: string) => {
      const el = textareaRef.current;
      setText(roomId, (prev) => {
        const start = el?.selectionStart ?? prev.length;
        const end = el?.selectionEnd ?? start;
        pendingCaretRef.current = start + emoji.length;
        return `${prev.slice(0, start)}${emoji}${prev.slice(end)}`;
      });
      ensureClientMessageId();
    },
    [ensureClientMessageId, roomId, setText],
  );

  const handleSubmit = useCallback(async () => {
    if (disabled || !hasContent || tooLong || isSending) return;
    const clientMessageId = ensureClientMessageId();
    setSending(true);
    setError(null);
    const ok = await onSubmit({
      clientMessageId,
      body: draft,
      fileIds: attachments.map((a) => a.fileId),
      mentions: collectMentionIds(draft, roomDraft.mentions, MAX_MENTIONS_PER_MESSAGE),
      ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
    });
    // Dọn nháp đã gửi TRƯỚC chốt `isMountedRef`: store sống ngoài cây, nên đổi phòng lúc tin đang bay mà
    // không dọn ở đây thì quay lại sẽ thấy nguyên tin vừa gửi — bấm Enter là gửi trùng.
    if (ok) useChatDraftStore.getState().clearSentDraft(roomId, clientMessageId);
    if (!isMountedRef.current) return; // xem docblock của `isMountedRef` — cây đã tháo, dừng tại đây
    setSending(false);

    if (!ok) {
      // §14: KHÔNG mất nội dung đang soạn. Nháp + tệp + khoá idempotency + bảng mention đều giữ nguyên;
      // bong bóng "gửi lỗi" ở danh sách tin là nơi bấm "Gửi lại".
      setError(t("composer.sendFailed"));
      return;
    }
    // Chữ + mention + khoá idempotency đã dọn ở `clearSentDraft` (tin kế tiếp là tin KHÁC ⇒ khoá mới).
    // Bộ đếm cảnh báo rời phòng hạ ĐỒNG BỘ: tháo trước lượt vẽ dọn khay thì effect đồng bộ chưa chạy,
    // cleanup sẽ đọc số tệp cũ và cảnh báo «bị bỏ» cho chính tệp vừa gửi đi.
    pendingFileCountRef.current = 0;
    setAttachments([]);
    previews.revokeAll();
    onCancelReply();
  }, [
    attachments,
    disabled,
    draft,
    ensureClientMessageId,
    hasContent,
    isSending,
    onCancelReply,
    onSubmit,
    previews,
    replyTo,
    roomDraft.mentions,
    roomId,
    t,
    tooLong,
  ]);

  const placeholder = isArchived
    ? t("composer.placeholderArchived")
    : !canSend
      ? t("composer.placeholderNoPermission")
      : t("composer.placeholder");

  return (
    <div
      className="relative border-t border-border bg-background p-3"
      data-testid="chat-composer"
      // Dán + kéo-thả — xem `use-file-drop.ts` (gắn ở ROOT, không ở textarea).
      {...fileDrop}
    >
      <ComposerNotices
        isArchived={isArchived}
        replyTo={replyTo}
        replyQuote={replyQuote}
        onCancelReply={onCancelReply}
        uploading={uploading}
        error={error}
        tooLong={tooLong}
      />

      {roomDraft.droppedFileCount > 0 && (
        <p
          role="status"
          className="mb-2 text-xs text-muted-foreground"
          data-testid="chat-composer-files-not-kept"
        >
          {t("composer.filesNotKept", { count: roomDraft.droppedFileCount })}
        </p>
      )}

      {attachments.length > 0 && (
        <AttachmentPreviewList items={attachments} onRemove={removeAttachment} />
      )}

      {mention.isOpen && (
        <MentionPopover
          suggestions={mention.suggestions}
          activeIndex={mention.activeIndex}
          listboxId={MENTION_LISTBOX_ID}
          onPick={pickMention}
        />
      )}

      <div className="flex items-end gap-2">
        {/* Xem `composer/ComposerActions.tsx`: dải nút này CÓ CÙNG cổng với ô soạn (`!disabled`). */}
        {!disabled && (
          <ComposerActions
            uploading={uploading}
            onFiles={acceptFiles}
            onInsertEmoji={insertEmoji}
          />
        )}

        <textarea
          key={roomId}
          ref={textareaRef}
          value={draft}
          /*
           * a11y: tiêu điểm DOM Ở LẠI textarea, trình đọc màn hình theo `aria-activedescendant` để đọc
           * dòng gợi ý đang trỏ.
           *
           * ⚠️ KHÔNG đổi sang `role="combobox"` và KHÔNG thêm `aria-expanded`:
           *  - `combobox` **thay** vai trò ngầm `textbox` của `<textarea>` ⇒ mọi spec đang dùng
           *    `getByRole("textbox")` đỏ hàng loạt, và đó là bất biến B5 của WO này;
           *  - `aria-expanded` không nằm trong tập thuộc tính mà vai trò `textbox` hỗ trợ.
           * `aria-autocomplete` + `aria-activedescendant` thì `textbox` CÓ hỗ trợ — đủ để đọc gợi ý.
           */
          aria-autocomplete="list"
          {...(mention.isOpen
            ? {
                "aria-controls": MENTION_LISTBOX_ID,
                "aria-activedescendant": mentionOptionId(MENTION_LISTBOX_ID, mention.activeIndex),
              }
            : {})}
          onChange={(e) => {
            const value = e.target.value;
            setText(roomId, value);
            mention.sync(value, e.target.selectionStart ?? value.length);
            if (value.length > 0) {
              ensureClientMessageId();
              // Chỉ ping khi ô CÓ chữ: xoá sạch nháp rồi bấm backspace tiếp không phải là "đang gõ".
              pingTyping();
            }
          }}
          // Rời ô soạn ⇒ ĐÓNG gợi ý (chọn bằng chuột KHÔNG rơi vào đây: `MentionPopover` bắt
          // `onMouseDown` + `preventDefault()` nên tiêu điểm chưa từng rời textarea). Vì sao không
          // đồng bộ thêm theo `onSelect`: xem docblock của `sync` ở `use-mention-autocomplete.ts`.
          onBlur={() => mention.close()}
          onKeyDown={(e) => {
            // Popover mention ĐANG MỞ nuốt trọn bộ phím điều hướng — nhất là Enter: nó phải CHỌN gợi ý,
            // KHÔNG gửi tin. Gửi nhầm ở đây là gửi một tin đang viết dở với `@ng` chưa thành tên ai.
            if (mention.handleKeyDown(e, pickMention)) return;
            // Enter gửi, Shift+Enter xuống dòng — quy ước quen thuộc của mọi công cụ chat nội bộ.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          aria-label={t("composer.placeholder")}
          className={cn(
            "max-h-32 min-h-10 flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />

        <Button
          size="icon-sm"
          aria-label={t("composer.sendAria")}
          disabled={disabled || !hasContent || tooLong || isSending}
          onClick={() => void handleSubmit()}
        >
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
