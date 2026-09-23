/**
 * S16-SOCIAL-FE-1 — ô soạn bài của `SOC-SCREEN-001` (SOCIAL-API-002).
 *
 * ┌─ 🔴 ĐÚNG HAI NÚT — và lý do đã ĐỔI ở T0 23/09/2026, đọc kỹ trước khi thêm nút thứ ba ─────────┐
 * │ Plan D2 ban đầu lập luận «`feedCreatableTypeSchema` = `["share","news"]` nên BE từ chối 3 loại │
 * │ kia». Đo lại sau khi BE-2B-1 (#534) merge: enum nay là **`["share","news","poll"]`**.          │
 * │ ⇒ Chia làm hai vế:                                                                             │
 * │   • `idea`/`kudos` — contracts VẪN từ chối ⇒ render nút là UI dối, lập luận cũ còn nguyên.     │
 * │   • `poll`        — BE **nhận** rồi. Bỏ nút poll ở đây là **quyết định PHẠM VI của owner**,    │
 * │                     KHÔNG phải bất khả thi kỹ thuật. Cụm bình chọn cần 4 mảnh đi cùng nhau     │
 * │                     (nút · form soạn lựa chọn · thẻ bài dạng poll · màn bỏ phiếu); ship nửa    │
 * │                     cụm sẽ đẻ ra bài mà `PostCard` của FE-1 chỉ vẽ được phần vỏ (xem R16).     │
 * │                     Cả cụm thuộc `S16-SOCIAL-FE-2` (nợ N3).                                    │
 * │ Ca **C4** ghim đúng con số 2 — nó là cổng chống mở phạm vi, không phải một phép đếm vu vơ.     │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Gate: nút «Tin tức» bọc `manage:feed-news` vì route 002 có `tier1IsFloor` — decorator chỉ đòi
 * `create:feed-post`, còn nhánh `type='news'` đòi THÊM `manage:feed-news` ở tầng 2. Không gate thì
 * người dùng soạn xong mới ăn 403.
 *
 * ⚠️ **KHÔNG có nút đính kèm** (plan D8 · nợ N1): không tồn tại `POST /social/files/upload-url`, và
 * `foundation/files` đòi cặp `*:foundation-file` mà nhân viên thường KHÔNG có. Dựng UI cho một đường
 * 403-với-90%-người-dùng là làm giả. `S16-SOCIAL-BE-1C` mở đường, `FE-2` dựng UI.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Megaphone, Share2 } from "lucide-react";
import { Button, cn } from "@mediaos/ui";
import { PermissionGate, useCan } from "@mediaos/web-core";
import { FEED_BODY_MAX, type CreateFeedPostDto } from "@mediaos/contracts";

/** Hai loại bài mà FE-1 soạn được. Xem docblock đầu file trước khi thêm phần tử thứ ba. */
type ComposerType = "share" | "news";

interface FeedComposerProps {
  onSubmit: (dto: CreateFeedPostDto) => void;
  isSubmitting: boolean;
  /** Nội dung điền sẵn (widget Sinh nhật «Gửi lời chúc» — D12: chỉ MỞ composer, không tự đăng). */
  prefillBody?: string;
  className?: string;
}

export function FeedComposer({
  onSubmit,
  isSubmitting,
  prefillBody,
  className,
}: FeedComposerProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const canCreatePost = useCan("create", "feed-post");

  const [type, setType] = React.useState<ComposerType>("share");
  const [body, setBody] = React.useState(prefillBody ?? "");
  const [requiresAck, setRequiresAck] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

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
  // `share`/`news` BẮT BUỘC có body (`superRefine` của createFeedPostSchema) — chặn ở đây để người
  // dùng thấy lý do, thay vì nhận 400 vô danh từ Zod của server.
  const canSubmit = trimmed.length > 0 && !tooLong && !isSubmitting;

  const submit = (): void => {
    setTouched(true);
    if (!canSubmit) return;
    onSubmit({
      type,
      audience: "company",
      body: trimmed,
      requiresAck: type === "news" ? requiresAck : false,
    } as CreateFeedPostDto);
    setBody("");
    setRequiresAck(false);
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
      </div>

      <label className="sr-only" htmlFor="feed-composer-body">
        {type === "news" ? t("composer.newsPlaceholder") : t("composer.placeholder")}
      </label>
      <textarea
        id="feed-composer-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={type === "news" ? t("composer.newsPlaceholder") : t("composer.placeholder")}
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

      {touched && trimmed.length === 0 && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("composer.bodyRequired")}
        </p>
      )}
      {tooLong && (
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
          {isSubmitting ? t("composer.submitting") : t("composer.submit")}
        </Button>
      </div>
    </section>
  );
}
