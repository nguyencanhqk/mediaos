/**
 * S16-SOCIAL-FE-2 — các trường bình chọn của ô soạn (plan D4 + §8 M7).
 *
 * Component ĐIỀU KHIỂN hoàn toàn: nháp sống ở `FeedComposer`, nên luật «không dọn khi chưa được xác
 * nhận» (H2 của FE-1) áp cho cả câu hỏi/lựa chọn — mạng rớt thì 10 lựa chọn vừa gõ vẫn còn.
 * Luật kiểm ở `lib/poll-draft.ts`.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { Button, Input } from "@mediaos/ui";
import { FEED_POLL_QUESTION_MAX } from "@mediaos/contracts";
import {
  POLL_OPTION_LABEL_MAX,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  type PollDraft,
} from "../lib/poll-draft";

interface PollComposerFieldsProps {
  draft: PollDraft;
  onChange: (next: PollDraft) => void;
  disabled?: boolean;
}

export function PollComposerFields({
  draft,
  onChange,
  disabled = false,
}: PollComposerFieldsProps): React.ReactElement {
  const { t } = useTranslation("social");

  const setOption = (index: number, value: string): void =>
    onChange({ ...draft, options: draft.options.map((o, i) => (i === index ? value : o)) });

  const removeOption = (index: number): void =>
    onChange({ ...draft, options: draft.options.filter((_, i) => i !== index) });

  const addOption = (): void => onChange({ ...draft, options: [...draft.options, ""] });

  return (
    <div data-testid="composer-poll-fields" className="mt-3 space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-foreground">{t("composer.poll.question")}</span>
        <Input
          data-testid="composer-poll-question"
          value={draft.question}
          maxLength={FEED_POLL_QUESTION_MAX}
          placeholder={t("composer.poll.questionPlaceholder")}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, question: e.target.value })}
        />
      </label>

      <ol className="space-y-2" data-testid="composer-poll-options">
        {draft.options.map((option, index) => (
          // Chỉ số làm key là CỐ Ý: hàng không có id, và xoá một hàng ở giữa thì React phải vẽ lại
          // các hàng sau theo giá trị mới — `value` điều khiển nên không lệch nội dung.
          <li key={index} className="flex items-center gap-2">
            <Input
              data-testid={`composer-poll-option-${index}`}
              aria-label={t("composer.poll.optionLabel", { index: index + 1 })}
              placeholder={t("composer.poll.optionLabel", { index: index + 1 })}
              value={option}
              maxLength={POLL_OPTION_LABEL_MAX}
              disabled={disabled}
              onChange={(e) => setOption(index, e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("composer.poll.removeOption", { index: index + 1 })}
              data-testid={`composer-poll-remove-${index}`}
              disabled={disabled || draft.options.length <= POLL_OPTIONS_MIN}
              onClick={() => removeOption(index)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>

      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="composer-poll-add"
        disabled={disabled || draft.options.length >= POLL_OPTIONS_MAX}
        onClick={addOption}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t("composer.poll.addOption")}
      </Button>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="composer-poll-multiple"
            checked={draft.multipleChoice}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, multipleChoice: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          {t("composer.poll.multipleChoice")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="composer-poll-anonymous"
            checked={draft.isAnonymous}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, isAnonymous: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          {t("composer.poll.anonymous")}
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">{t("composer.poll.closesAt")}</span>
        <Input
          type="datetime-local"
          data-testid="composer-poll-closes-at"
          value={draft.closesAtLocal}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, closesAtLocal: e.target.value })}
          className="w-auto"
        />
      </label>

      <p className="text-xs text-muted-foreground">{t("composer.poll.immutableHint")}</p>
    </div>
  );
}
