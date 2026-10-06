/**
 * S16-SOCIAL-FE-3B (L4) — hộp thoại TẠO (`SOCIAL-API-049`) / SỬA (`SOCIAL-API-050`) một huy hiệu vinh danh,
 * màn `SOC-SCREEN-012`.
 *
 * ┌─ HỢP ĐỒNG VỚI TRANG (nơi mount) ─────────────────────────────────────────────────────────────────────┐
 * │ `{target !== undefined && <BadgeFormDialog badge={target} onClose onOutcome onStale />}`               │
 * │  · `badge: null` = TẠO; `badge: <huy hiệu>` = SỬA huy hiệu đó. CHỈ mount khi mở, unmount khi đóng:    │
 * │    mỗi lượt mount = một `attemptId` của 049 (xem 🔴 dưới).                                             │
 * │  · Nháp gắn với MỘT đích: component tự mount lại phần thân theo id huy hiệu, nên nơi mount đổi `badge` │
 * │    sang huy hiệu khác mà quên `key` cũng KHÔNG ghi nháp của huy hiệu trước lên huy hiệu sau.           │
 * │  · Chế độ sửa so với huy hiệu LÚC MỞ: `badge` được làm mới trong lúc hộp thoại mở (trang đọc lại danh │
 * │    sách) không đổi tập trường gửi đi — chỉ gửi thứ người dùng đã đổi so với thứ họ nhìn thấy.          │
 * │                                                                                                      │
 * │ HAI CALLBACK KẾT THÚC — mỗi lượt mở kết thúc bằng ĐÚNG MỘT trong hai                                  │
 * │  · `onClose()` — người dùng tự đóng («Huỷ» · Esc · bấm ra ngoài), hoặc bấm «Lưu» ở chế độ sửa khi      │
 * │    KHÔNG đổi gì (không có gì để gửi). Trang chỉ cần unmount. Không được gọi khi đang gửi.              │
 * │  · `onOutcome(outcome)` — lượt ghi đã có kết cục cuối. TRANG phải unmount hộp thoại rồi:               │
 * │      `kind: "done"`   ⇒ invalidate `socialKeys.kudos.badgesAdminAll()` VÀ `socialKeys.kudos.badges()`  │
 * │                         (ô chọn huy hiệu của composer — plan D13); `badge` là hàng server trả.         │
 * │      `kind: "failed"` ⇒ vẽ `<AdminErrorNotice reason={outcome.reason} />` ở TRANG, không `onRetry`;    │
 * │                         `invalidate === true` (huy hiệu không còn) ⇒ invalidate đúng hai khoá trên.    │
 * │    Sau `onOutcome` hộp thoại tự khoá — trang chậm unmount cũng không gửi được lượt hai.                │
 * │                                                                                                      │
 * │ MỘT CALLBACK GIỮA CHỪNG — không kết thúc lượt mở                                                      │
 * │  · `onStale()` — một lỗi GIỮ hộp thoại cho thấy danh sách đã / có thể đã cũ: mã đã dùng (409), hoặc    │
 * │    không có câu trả lời đọc được (5xx · hết hạn chờ · mất phản hồi · 2xx sai schema — server có thể    │
 * │    ĐÃ ghi). TRANG invalidate hai khoá trên NGAY; hộp thoại vẫn mở, nháp còn nguyên.                    │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cổng: KHÔNG có cổng riêng — route của màn đã gác `manage:feed-kudos`, cặp mà cả 049 lẫn 050 đòi (plan M7).
 * Server vẫn là cổng cuối (403 ⇒ kết cục `forbidden`).
 *
 * Lượt ghi đi qua `useGuardedMutation` (khoá đồng bộ chống gửi đúp · hỏng ngay khi offline · hạn chờ 30
 * giây) — 050 không idempotent ở server, và một yêu cầu treo không được khoá hộp thoại không lối ra. Nháp →
 * body đọc từ `lib/badge-form`; việc phải làm sau mỗi lỗi đọc từ `lib/badge-errors`.
 *
 * 🔴 `attemptId` (plan D20 · B22): 049 `@Idempotent`, server giữ phản hồi theo khoá 15 phút. Khoá suy từ nội
 * dung THUẦN sẽ phát lại 201 cũ cho ca «tạo → ngừng dùng → tạo lại y hệt» thay vì 409 «mã đã dùng». Nên khoá
 * = băm `{ attemptId, body }` (`createBadge`), `attemptId` sinh ĐÚNG MỘT lần mỗi lượt mount: gửi lại trong
 * cùng lượt mở ⇒ cùng khoá; mở lại ⇒ khoá mới.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@mediaos/ui";
import { createIdempotencyKey, socialKudosApi } from "@mediaos/web-core";
import type {
  CreateKudosBadgeDto,
  KudosBadgeAdminDto,
  UpdateKudosBadgeDto,
} from "@mediaos/contracts";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import type { AdminErrorReason } from "../../admin/lib/admin-errors";
import { useGuardedMutation } from "../../admin/lib/use-guarded-mutation";
import { DialogActions } from "../../moderation/components/dialog-fields";
import { describeCreateBadgeError, describeUpdateBadgeError } from "../lib/badge-errors";
import {
  buildCreateBadgeBody,
  buildUpdateBadgeBody,
  draftFromBadge,
  emptyBadgeDraft,
  type BadgeDraft,
  type BadgeField,
  type BadgeSubmission,
} from "../lib/badge-form";
import { BadgeFormFields, badgeInputId } from "./badge-form-fields";

export type BadgeFormMode = "create" | "edit";

/** Kết cục CUỐI của một lượt mở — xem «HỢP ĐỒNG VỚI TRANG» ở đầu file. */
export type BadgeFormOutcome =
  | { kind: "done"; mode: BadgeFormMode; badge: KudosBadgeAdminDto }
  | { kind: "failed"; mode: BadgeFormMode; reason: AdminErrorReason; invalidate: boolean };

export interface BadgeFormDialogProps {
  /** `null` = tạo huy hiệu mới; ngược lại = sửa huy hiệu này. */
  badge: KudosBadgeAdminDto | null;
  /** Người dùng tự đóng / không có gì để lưu. Không bao giờ đi kèm `onOutcome`. */
  onClose: () => void;
  /** Lượt ghi đã có kết cục cuối — trang unmount hộp thoại, invalidate và vẽ dải (nếu `failed`). */
  onOutcome: (outcome: BadgeFormOutcome) => void;
  /** Danh sách đã (hoặc có thể đã) cũ nhưng hộp thoại CÒN mở — trang đọc lại ngay. */
  onStale: () => void;
}

type SaveVariables =
  | { mode: "create"; body: CreateKudosBadgeDto; attemptId: string }
  | { mode: "edit"; badgeId: string; body: UpdateKudosBadgeDto };

/** Lỗi «giữ hộp thoại» đang hiển thị. `field` ⇒ dải vẽ cạnh ô đó thay vì cuối form. */
interface KeptFormError {
  reason: AdminErrorReason;
  retryable: boolean;
  field: "code" | null;
}

const CREATE_KEY = "create";

/** Ô của form mà một khoá của nháp thuộc về (hai ô icon chung một trường của server). */
const FIELD_OF_DRAFT_KEY: Readonly<Record<keyof BadgeDraft, BadgeField>> = {
  code: "code",
  name: "name",
  description: "description",
  iconName: "icon",
  emoji: "icon",
  position: "position",
};

/** Nháp → thứ sẽ lên dây. `nextAttemptId` chỉ được gọi khi THẬT SỰ có body 049 để gửi. */
function planSave(
  opened: KudosBadgeAdminDto | null,
  draft: BadgeDraft,
  nextAttemptId: () => string,
): BadgeSubmission<SaveVariables> {
  if (opened === null) {
    const created = buildCreateBadgeBody(draft);
    if (created.kind !== "ready") return created;
    return {
      kind: "ready",
      body: { mode: "create", body: created.body, attemptId: nextAttemptId() },
    };
  }
  const updated = buildUpdateBadgeBody(opened, draft);
  if (updated.kind !== "ready") return updated;
  return { kind: "ready", body: { mode: "edit", badgeId: opened.id, body: updated.body } };
}

function sendSave(variables: SaveVariables): Promise<KudosBadgeAdminDto> {
  return variables.mode === "create"
    ? socialKudosApi.createBadge(variables.body, variables.attemptId)
    : socialKudosApi.updateBadge(variables.badgeId, variables.body);
}

/**
 * Vỏ: mount lại phần thân khi ĐÍCH đổi (id huy hiệu, hoặc sửa ↔ tạo). Nháp, tập ô sai, dải lỗi và
 * `attemptId` đều là state của phần thân ⇒ không thứ nào sống qua lần đổi đích.
 */
export function BadgeFormDialog(props: BadgeFormDialogProps): React.ReactElement {
  return <BadgeFormDialogBody key={props.badge?.id ?? CREATE_KEY} {...props} />;
}

function BadgeFormDialogBody({
  badge,
  onClose,
  onOutcome,
  onStale,
}: BadgeFormDialogProps): React.ReactElement {
  const { t } = useTranslation("social");
  const formId = React.useId();
  // Huy hiệu LÚC MỞ: mốc so «đã đổi gì» và id gửi đi. Không chạy theo `badge` được làm mới giữa chừng.
  const [opened] = React.useState(badge);
  const mode: BadgeFormMode = opened === null ? "create" : "edit";

  const [draft, setDraft] = React.useState<BadgeDraft>(() =>
    opened === null ? emptyBadgeDraft() : draftFromBadge(opened),
  );
  const [invalid, setInvalid] = React.useState<readonly BadgeField[]>([]);
  const [error, setError] = React.useState<KeptFormError | null>(null);
  const [hasOutcome, setHasOutcome] = React.useState(false);
  // Cờ ĐỒNG BỘ «lượt mở này ĐÃ có kết cục cuối» — state tới màn sau một nhịp, cú đóng cùng nhịp với kết cục
  // sẽ thấy giá trị cũ và trang nhận cả `onClose` lẫn `onOutcome`. Không bao giờ nhả.
  const hasOutcomeRef = React.useRef(false);
  // MỘT giá trị cho cả lượt mount (xem 🔴 ở đầu file). Khởi tạo lười: chế độ sửa không bao giờ sinh.
  const attemptIdRef = React.useRef<string | null>(null);
  const nextAttemptId = (): string => (attemptIdRef.current ??= createIdempotencyKey());

  const formElementId = `${formId}-form`;

  const focusField = (field: BadgeField): void => {
    document.getElementById(badgeInputId(formId, field))?.focus();
  };

  // `Dialog` focus phần tử focusable ĐẦU TIÊN khi mở — ở chế độ sửa đó là ô mã chỉ-đọc. Effect của component
  // cha chạy SAU effect của `Dialog` (con) nên lượt focus này thắng; `Dialog` đã kịp nhớ nút kích hoạt.
  React.useEffect(() => {
    if (opened !== null) document.getElementById(badgeInputId(formId, "name"))?.focus();
  }, [opened, formId]);

  const finish = (outcome: BadgeFormOutcome): void => {
    hasOutcomeRef.current = true;
    setHasOutcome(true);
    onOutcome(outcome);
  };

  const save = useGuardedMutation<KudosBadgeAdminDto, SaveVariables>({
    mutationFn: sendSave,
    onSuccess: (saved, variables) => {
      finish({ kind: "done", mode: variables.mode, badge: saved });
    },
    onError: (err, variables) => {
      const { dialog, reason, field, invalidate, retryable } =
        variables.mode === "create" ? describeCreateBadgeError(err) : describeUpdateBadgeError(err);
      if (dialog === "close") {
        finish({ kind: "failed", mode: variables.mode, reason, invalidate });
        return;
      }
      if (invalidate) onStale();
      setError({ reason, retryable, field });
      // Nút «Lưu» đang giữ focus vừa qua một lượt khoá ⇒ đưa focus tới chỗ cần sửa.
      if (field !== null) focusField(field);
    },
  });

  const canSubmit = !save.isPending && !hasOutcome;

  // Hỏi CẢ cờ đồng bộ: Esc / bấm ra ngoài / «Huỷ» cùng nhịp với «Lưu» thấy `isPending` còn `false`. Sau
  // một lỗi GIỮ hộp thoại (kể cả hết hạn chờ) khoá đã nhả ⇒ đóng được.
  const close = (): void => {
    if (!save.isPending && !save.isLocked() && !hasOutcomeRef.current) onClose();
  };

  const change = (key: keyof BadgeDraft, value: string): void => {
    const field = FIELD_OF_DRAFT_KEY[key];
    // Ô emoji THẮNG ô chọn (`draftIcon`): CHỌN một biểu tượng mà emoji cũ còn đó thì lựa chọn không có hiệu
    // lực và «Lưu» ở chế độ sửa ra «không đổi gì». Lựa chọn có giá trị là ý muốn tường minh ⇒ thay emoji.
    const replacesEmoji = key === "iconName" && value !== "";
    setDraft((current) => ({ ...current, [key]: value, ...(replacesEmoji ? { emoji: "" } : {}) }));
    // Dấu lỗi chỉ đúng cho giá trị đã bị từ chối: gõ lại ô nào thì gỡ dấu của CHÍNH ô đó.
    setInvalid((current) => current.filter((item) => item !== field));
    setError((current) => (current !== null && current.field === field ? null : current));
  };

  const submit = (): void => {
    if (!canSubmit || hasOutcomeRef.current) return;
    const plan = planSave(opened, draft, nextAttemptId);
    if (plan.kind === "unchanged") {
      close();
      return;
    }
    if (plan.kind === "invalid") {
      setInvalid(plan.fields);
      const [first] = plan.fields;
      // Body hỏng mà không quy được về ô nào ⇒ vẫn phải NÓI ra, không im lặng.
      setError(
        first === undefined ? { reason: "invalidRequest", retryable: false, field: null } : null,
      );
      if (first !== undefined) focusField(first);
      return;
    }
    // `start` là CỔNG gửi-đúp duy nhất (khoá đồng bộ của hook): lượt hai trong cùng nhịp nhận `false`.
    if (save.start(plan.body)) {
      setInvalid([]);
      setError(null);
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      title={t(`admin.badges.form.title.${mode}`)}
      footer={
        <DialogActions
          cancelLabel={t("admin.badges.form.cancel")}
          submitLabel={t("admin.badges.form.submit")}
          isPending={save.isPending}
          canSubmit={canSubmit}
          onCancel={close}
          onSubmit={submit}
          submitFormId={formElementId}
        />
      }
    >
      <div className="flex flex-col gap-4" data-testid="badge-form-dialog" data-mode={mode}>
        {/* `<form>` thật: Enter trong một ô là lưu. Kiểm tra là việc của `planSave` (`noValidate`). */}
        <form
          id={formElementId}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <BadgeFormFields
            formId={formId}
            isCodeLocked={mode === "edit"}
            draft={draft}
            invalid={invalid}
            codeNotice={
              error?.field === "code" ? <AdminErrorNotice reason={error.reason} /> : undefined
            }
            onChange={change}
          />
        </form>

        {error !== null && error.field === null && (
          <AdminErrorNotice
            reason={error.reason}
            onDismiss={() => setError(null)}
            {...(error.retryable && canSubmit ? { onRetry: submit } : {})}
          />
        )}
      </div>
    </Dialog>
  );
}
