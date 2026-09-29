/**
 * S16-SOCIAL-FE-1 → FE-2 — ô soạn bài của `SOC-SCREEN-001` (SOCIAL-API-002).
 *
 * ┌─ 🔴 NĂM NÚT (S16-SOCIAL-FE-2C) — đọc kỹ trước khi thêm nút thứ sáu ──────────────────────────────┐
 * │ Chia sẻ · Tin tức (`manage:feed-news`) · Bình chọn (`create:feed-poll`) · Sáng kiến             │
 * │ (`create:feed-idea`) · Vinh danh (`create:feed-kudos`). Mỗi nút gác bằng ĐÚNG cặp tầng-2 của     │
 * │ `SOCIAL_POST_TYPE_PAIRS` — không gate thì người dùng soạn xong mới ăn 403. Ca **C4** ghim tập 5. │
 * │ «Vinh danh» VẮNG ở composer NHÓM (`groupId`, owner ký O3): người nhận ngoài nhóm kín vẫn nhận   │
 * │ NOTI-033 trỏ tới bài họ không mở được. Ca **G1** ghim điều đó.                                  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Vinh danh: ô soạn chính thành LỜI NHẮN (bắt buộc — `kudos.message`), KHÔNG gửi `body`; người nhận ·
 * huy hiệu · cờ «chính thức» ở `KudosComposerFields`, nháp giữ TẠI ĐÂY (cùng luật với poll bên dưới).
 *
 * Bình chọn: ô soạn chính thành MÔ TẢ tuỳ chọn (trống ⇒ BỎ khoá `body`, không gửi `""` — contracts
 * `.trim().min(1)` từ chối chuỗi rỗng); các trường poll nằm ở `PollComposerFields`, nháp giữ TẠI ĐÂY
 * để luật «không dọn khi chưa được xác nhận» áp cho cả chúng.
 *
 * ⚠️ **KHÔNG có nút đính kèm**: UI đính kèm qua `SOCIAL-API-054/055` là nợ N1 của FE-1, giao
 * `S16-SOCIAL-FE-2D`.
 *
 * S16-SOCIAL-FE-2B — `groupId` ⇒ MỌI loại bài đăng vào nhóm (`audience:'group'`). KHÔNG có ô chọn
 * phạm vi ở bảng tin chung: bài nhóm bị LOẠI khỏi `001` feed chung (D-OWNER-5 của BE-2A), nên đăng
 * vào nhóm từ `/feed` là bài «biến mất» ngay sau khi đăng. Ô soạn nhóm chỉ sống trên trang nhóm.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Award, BarChart3, Lightbulb, Megaphone, Share2 } from "lucide-react";
import { Button, cn } from "@mediaos/ui";
import { PermissionGate, useCan } from "@mediaos/web-core";
import {
  FEED_BODY_MAX,
  FEED_POLL_QUESTION_MAX,
  KUDOS_RECIPIENT_MAX,
  type CreateFeedPostDto,
} from "@mediaos/contracts";
import { PollComposerFields } from "./PollComposerFields";
import { KudosComposerFields } from "../../kudos/components/KudosComposerFields";
import { EMPTY_KUDOS_DRAFT, validateKudosDraft, type KudosDraft } from "../../kudos/lib/kudos-draft";
import {
  EMPTY_POLL_DRAFT,
  POLL_OPTION_LABEL_MAX,
  validatePollDraft,
  type PollDraft,
} from "../lib/poll-draft";

/** Năm loại bài soạn được. Xem docblock đầu file trước khi thêm phần tử thứ sáu. */
type ComposerType = "share" | "news" | "poll" | "idea" | "kudos";

/**
 * `then` là tín hiệu DUY NHẤT mà ô soạn có để biết "server đã nhận chưa". Không có nó thì mọi phán
 * đoán về thành-công/thất-bại đều là đoán mò — xem hộp «KHÔNG DỌN KHI CHƯA ĐƯỢC XÁC NHẬN» dưới đây.
 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function";
}

interface FeedComposerProps {
  /**
   * Gửi bài lên caller.
   *
   * ┌─ 🔴 KHÔNG DỌN Ô SOẠN KHI CHƯA ĐƯỢC XÁC NHẬN (lỗi H2, vá 23/09/2026) ─────────────────────────┐
   * │ Bản trước gọi `setBody("")` NGAY sau `onSubmit` — fire-and-forget. Ca hỏng thật: soạn 1.500   │
   * │ chữ → bấm «Đăng» → rớt mạng 1 giây → ô soạn TRỐNG, bảng tin không có bài mới, không một chữ   │
   * │ báo lỗi. Không có đường nào lấy lại nội dung đã gõ ⇒ **mất trắng dữ liệu người dùng**.        │
   * │ Chuỗi i18n `actionError.generic.post` còn hứa thẳng «Nội dung bạn gõ vẫn còn trong ô soạn» —  │
   * │ dọn sớm biến câu đó thành lời nói dối.                                                        │
   * │                                                                                                │
   * │ ⇒ Hợp đồng mới: **trả về Promise** (ví dụ `mutation.mutateAsync(dto)`) thì ô soạn tự dọn khi  │
   * │ promise RESOLVE, và giữ nguyên từng ký tự khi nó REJECT.                                      │
   * │ Caller trả `void` (ví dụ `mutation.mutate`) ⇒ ô soạn **KHÔNG dọn**: thà để người dùng tự xoá  │
   * │ một bài đã đăng xong còn hơn nuốt mất bài chưa đăng được. Khoá `Idempotency-Key` suy-từ-nội-   │
   * │ dung ở `socialApi.createPost` làm lượt gửi lặp cùng nội dung không đẻ ra bài thứ hai.         │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  onSubmit: (dto: CreateFeedPostDto) => void | Promise<unknown>;
  isSubmitting: boolean;
  /** Nội dung điền sẵn (widget Sinh nhật «Gửi lời chúc» — D12: chỉ MỞ composer, không tự đăng). */
  prefillBody?: string;
  /** S16-SOCIAL-FE-2B — có ⇒ `audience:'group', groupId` cho mọi loại bài; vắng ⇒ `audience:'company'`. */
  groupId?: string;
  className?: string;
}

export function FeedComposer({
  onSubmit,
  isSubmitting,
  prefillBody,
  groupId,
  className,
}: FeedComposerProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const canCreatePost = useCan("create", "feed-post");
  /** Cờ «chính thức» chỉ đi vào payload khi CÒN quyền (xem `validateKudosDraft`). */
  const canOfficialKudos = useCan("manage", "feed-kudos");

  const [type, setType] = React.useState<ComposerType>("share");
  const [body, setBody] = React.useState(prefillBody ?? "");
  const [requiresAck, setRequiresAck] = React.useState(false);
  const [pollDraft, setPollDraft] = React.useState<PollDraft>(EMPTY_POLL_DRAFT);
  const [kudosDraft, setKudosDraft] = React.useState<KudosDraft>(EMPTY_KUDOS_DRAFT);
  const [touched, setTouched] = React.useState(false);
  /**
   * Lượt gửi của CHÍNH ô soạn đang bay. Tách khỏi `isSubmitting` của caller vì nó là vế còn lại của
   * C26: từ khi ô soạn KHÔNG dọn rỗng ngay nữa, "nội dung trống ⇒ nút khoá" không còn chặn được cú
   * bấm thứ hai. Cờ này mới là thứ chặn.
   */
  const [sending, setSending] = React.useState(false);

  /**
   * Nạp nội dung điền sẵn khi người dùng bấm «Gửi lời chúc» ở widget Sinh nhật.
   *
   * Hai luật, cả hai đều để KHÔNG ăn mất chữ người dùng đang gõ:
   *  1. chỉ nạp khi ô đang RỖNG — đọc giá trị hiện tại qua **functional `setBody`** chứ không đưa
   *     `body` vào deps (đưa vào thì effect chạy lại mỗi lần gõ một ký tự);
   *  2. chỉ nạp khi `prefillBody` THỰC SỰ đổi — `ref` nhớ giá trị đã nạp, nên người dùng xoá đi rồi
   *     gõ lại không bị nhồi lại lời chúc cũ ở lần render kế tiếp.
   */
  const lastPrefillRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!prefillBody || prefillBody === lastPrefillRef.current) return;
    lastPrefillRef.current = prefillBody;
    setBody((current) => (current.trim().length === 0 ? prefillBody : current));
  }, [prefillBody]);

  /**
   * Không có `create:feed-post` ⇒ **ẩn cả ô soạn**, không hiện rồi báo lỗi (SPEC-16 §14).
   * Trả `null` thay vì một khung disabled: khung disabled vẫn chiếm chỗ đầu dòng cuộn và mời người
   * ta bấm thử.
   */
  if (!canCreatePost) return null;

  const trimmed = body.trim();
  const tooLong = trimmed.length > FEED_BODY_MAX;
  const busy = isSubmitting || sending;
  const isPoll = type === "poll";
  const pollCheck = isPoll ? validatePollDraft(pollDraft) : null;
  const isKudos = type === "kudos";
  const kudosCheck = isKudos ? validateKudosDraft(kudosDraft, body, canOfficialKudos) : null;
  // `share`/`news`/`idea` BẮT BUỘC có body (`superRefine` của createFeedPostSchema); `poll` thì body là
  // mô tả tuỳ chọn nhưng nháp poll phải hợp lệ; `kudos` thì nháp (người nhận + lời nhắn) phải hợp lệ.
  // Chặn ở đây để người dùng thấy lý do, thay vì nhận 400 vô danh từ Zod hoặc 422 từ service.
  const contentReady = isPoll
    ? pollCheck?.ok === true
    : isKudos
      ? kudosCheck?.ok === true
      : trimmed.length > 0;
  const canSubmit = contentReady && !tooLong && !busy;

  // `groupId` vắng ⇒ y hệt trước FE-2B (`audience:'company'`, không khoá `groupId` — contracts từ chối
  // `groupId` đi kèm `company`).
  const audience = groupId
    ? ({ audience: "group", groupId } as const)
    : ({ audience: "company" } as const);

  const buildDto = (): CreateFeedPostDto | null => {
    if (isKudos) {
      if (!kudosCheck?.ok) return null;
      // O3: nút kudos không có ở chế độ nhóm ⇒ luôn `company`, không `body` (lời nhắn là `kudos.message`).
      return {
        type: "kudos",
        audience: "company",
        requiresAck: false,
        kudos: kudosCheck.kudos,
      } as CreateFeedPostDto;
    }
    if (isPoll) {
      if (!pollCheck?.ok) return null;
      return {
        type: "poll",
        ...audience,
        ...(trimmed.length > 0 ? { body: trimmed } : {}),
        requiresAck: false,
        poll: pollCheck.poll,
      } as CreateFeedPostDto;
    }
    return {
      type,
      ...audience,
      body: trimmed,
      requiresAck: type === "news" ? requiresAck : false,
    } as CreateFeedPostDto;
  };

  const submit = (): void => {
    setTouched(true);
    if (!canSubmit) return;
    const dto = buildDto();
    if (!dto) return;
    const result = onSubmit(dto);

    // Caller không hứa gì ⇒ giữ NGUYÊN nội dung (xem hộp ở `FeedComposerProps.onSubmit`).
    if (!isPromiseLike(result)) return;

    setSending(true);
    result.then(
      () => {
        setBody("");
        setRequiresAck(false);
        setPollDraft(EMPTY_POLL_DRAFT);
        setKudosDraft(EMPTY_KUDOS_DRAFT);
        // Dọn cả `touched`: bỏ quên nó thì ngay sau một lượt đăng THÀNH CÔNG, ô rỗng + `touched`
        // còn bật sẽ bắn «Hãy nhập nội dung trước khi đăng» — một cảnh báo đỏ cho việc vừa xong.
        setTouched(false);
        setSending(false);
      },
      () => {
        // Hỏng ⇒ KHÔNG đụng vào `body`. Caller là chỗ nói ra lỗi (dải `ActionErrorBanner`).
        setSending(false);
      },
    );
  };

  const typeButton = (value: ComposerType, label: string, Icon: typeof Share2) => (
    <button
      type="button"
      onClick={() => setType(value)}
      aria-pressed={type === value}
      data-testid={`composer-type-${value}`}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        type === value
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );

  // Hai câu nói «gửi tới công ty» là SAI trong nhóm — đổi riêng ở chế độ nhóm; poll/idea thì trung tính.
  const placeholder =
    type === "news"
      ? t(groupId ? "composer.groupNewsPlaceholder" : "composer.newsPlaceholder")
      : type === "poll"
        ? t("composer.pollDescriptionPlaceholder")
        : type === "idea"
          ? t("composer.ideaPlaceholder")
          : type === "kudos"
            ? t("composer.kudosPlaceholder")
            : t(groupId ? "composer.groupPlaceholder" : "composer.placeholder");

  return (
    <section
      data-testid="feed-composer"
      className={cn("rounded-lg border border-border bg-card p-4", className)}
    >
      <div
        role="group"
        aria-label={t("composer.typeAria")}
        data-testid="composer-type-group"
        className="mb-3 flex flex-wrap gap-2"
      >
        {typeButton("share", t("composer.typeShare"), Share2)}

        {/*
          🔴 `manage:feed-news` — cặp TẦNG 2 của route 002 cho nhánh `type='news'`. Ca C3 ghim vế
          deny: không có cặp này thì composer chỉ còn ĐÚNG MỘT nút.
        */}
        <PermissionGate action="manage" resourceType="feed-news">
          {typeButton("news", t("composer.typeNews"), Megaphone)}
        </PermissionGate>

        {/* Cặp tầng-2 của `SOCIAL_POST_TYPE_PAIRS.poll` / `.idea` (ca P1/P2). */}
        <PermissionGate action="create" resourceType="feed-poll">
          {typeButton("poll", t("composer.typePoll"), BarChart3)}
        </PermissionGate>
        <PermissionGate action="create" resourceType="feed-idea">
          {typeButton("idea", t("composer.typeIdea"), Lightbulb)}
        </PermissionGate>
        {/* S16-SOCIAL-FE-2C — `SOCIAL_POST_TYPE_PAIRS.kudos`; VẮNG ở composer nhóm (O3, ca G1). */}
        {!groupId && (
          <PermissionGate action="create" resourceType="feed-kudos">
            {typeButton("kudos", t("composer.typeKudos"), Award)}
          </PermissionGate>
        )}
      </div>

      {isKudos && (
        <KudosComposerFields draft={kudosDraft} onChange={setKudosDraft} disabled={busy} />
      )}

      <label className="sr-only" htmlFor="feed-composer-body">
        {placeholder}
      </label>
      <textarea
        id="feed-composer-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {type === "news" && (
        <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={requiresAck}
            onChange={(e) => setRequiresAck(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          {t("composer.requiresAck")}
        </label>
      )}

      {isPoll && (
        <PollComposerFields draft={pollDraft} onChange={setPollDraft} disabled={busy} />
      )}

      {/* Kudos KHÔNG dùng hai alert chung (rỗng/quá dài) — nháp kudos sở hữu lỗi lời nhắn (§8 M-e). */}
      {touched && !isPoll && !isKudos && trimmed.length === 0 && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("composer.bodyRequired")}
        </p>
      )}
      {/*
        Hiện lý do ngay khi nháp poll đã bị SỬA (tham chiếu khác `EMPTY_POLL_DRAFT`), không đợi bấm
        «Đăng»: nút khoá khi nháp chưa hợp lệ nên cú bấm không tới được `submit` để bật `touched` —
        đợi nó là để người dùng nhìn một nút xám mà không biết vì sao.
      */}
      {(touched || pollDraft !== EMPTY_POLL_DRAFT) && pollCheck && !pollCheck.ok && (
        <p role="alert" data-testid="composer-poll-error" className="mt-2 text-sm text-destructive">
          {t(`composer.poll.${pollCheck.error}`, {
            max:
              pollCheck.error === "questionTooLong" ? FEED_POLL_QUESTION_MAX : POLL_OPTION_LABEL_MAX,
          })}
        </p>
      )}
      {/* Lời nhắn nằm NGOÀI nháp kudos ⇒ gõ lời nhắn cũng là «đã bắt đầu soạn» (gate LIGHT React LOW-2). */}
      {(touched || kudosDraft !== EMPTY_KUDOS_DRAFT || (isKudos && trimmed.length > 0)) &&
        kudosCheck &&
        !kudosCheck.ok && (
        <p role="alert" data-testid="composer-kudos-error" className="mt-2 text-sm text-destructive">
          {t(`composer.kudos.${kudosCheck.error}`, {
            max: kudosCheck.error === "messageTooLong" ? FEED_BODY_MAX : KUDOS_RECIPIENT_MAX,
          })}
        </p>
      )}
      {tooLong && !isKudos && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("composer.bodyTooLong", { max: FEED_BODY_MAX })}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        {/*
          🔴 C26 — nút KHOÁ khi đang gửi. Khoá idempotency suy-từ-nội-dung chặn được lần THỬ LẠI của
          cùng một payload, nhưng KHÔNG chặn được hai lần bấm liên tiếp nếu giữa hai lần đó nội dung
          đổi một ký tự. Vô hiệu hoá nút là vế còn lại của cùng một lời hứa.
        */}
        <Button type="button" onClick={submit} disabled={!canSubmit} data-testid="composer-submit">
          {busy ? t("composer.submitting") : t("composer.submit")}
        </Button>
      </div>
    </section>
  );
}
