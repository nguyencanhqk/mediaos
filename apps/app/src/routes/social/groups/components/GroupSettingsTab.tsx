/**
 * S16-SOCIAL-FE-2B — tab «Cài đặt» (`033` sửa · `034` xoá; plan D13).
 *
 * - Chỉ gửi trường ĐÃ ĐỔI so với nhóm hiện tại (sau chuẩn hoá: trim, mô tả rỗng ⇒ `null`). Không đổi gì
 *   ⇒ nút Lưu khoá: `updateFeedGroupSchema` từ chối body rỗng (400) — gửi đi là biến «không đổi gì»
 *   thành một lỗi.
 * - Đổi chế độ hiện hệ quả (→ riêng tư: người ngoài mất quyền đọc bài; → công khai: yêu cầu đang chờ
 *   VẪN chờ — `033` không tự duyệt).
 * - Xoá nhóm: chỉ `canDelete` (owner/manage; admin 403). Không có route khôi phục ⇒ hộp xác nhận nói
 *   thẳng. Điều hướng về danh sách TRƯỚC khi invalidate (trang này sẽ 404 — plan §8 M5b).
 *
 * Form nạp từ `group` một lần; trang nhóm render dưới `key={groupId}` nên sang nhóm khác là form MỚI
 * (plan §8 H2 — không PATCH nhầm nhóm bằng giá trị của nhóm trước).
 */
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, Input } from "@mediaos/ui";
import { socialGroupsApi, socialKeys } from "@mediaos/web-core";
import {
  FEED_GROUP_DESC_MAX,
  FEED_GROUP_NAME_MAX,
  type FeedGroupDto,
  type UpdateFeedGroupDto,
} from "@mediaos/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import type { GroupCapabilities } from "../lib/group-capabilities";
import type { GroupVisibilityValue } from "../lib/group-labels";
import { useGroupErrorState } from "../lib/use-group-membership";
import { GroupVisibilityField } from "./GroupVisibilityField";

interface GroupSettingsTabProps {
  group: FeedGroupDto;
  caps: GroupCapabilities;
}

/** Các trường đã đổi so với `group` (chuẩn hoá trước khi so). Rỗng ⇒ không có gì để lưu. */
export function changedGroupFields(
  group: Pick<FeedGroupDto, "name" | "description" | "visibility">,
  draft: { name: string; description: string; visibility: GroupVisibilityValue },
): Partial<UpdateFeedGroupDto> {
  const name = draft.name.trim();
  const description = draft.description.trim() || null;
  return {
    ...(name !== group.name ? { name } : {}),
    ...(description !== (group.description ?? null) ? { description } : {}),
    ...(draft.visibility !== group.visibility ? { visibility: draft.visibility } : {}),
  };
}

export function GroupSettingsTab({ group, caps }: GroupSettingsTabProps): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, setError, fail } = useGroupErrorState();
  const [name, setName] = React.useState(group.name);
  const [description, setDescription] = React.useState(group.description ?? "");
  const [visibility, setVisibility] = React.useState<GroupVisibilityValue>(group.visibility);
  const [saved, setSaved] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const changes = changedGroupFields(group, { name, description, visibility });
  const trimmedName = name.trim();
  const nameError =
    trimmedName.length === 0
      ? t("groups.create.nameRequired")
      : trimmedName.length > FEED_GROUP_NAME_MAX
        ? t("groups.create.nameTooLong", { max: FEED_GROUP_NAME_MAX })
        : null;
  const descError =
    description.trim().length > FEED_GROUP_DESC_MAX
      ? t("groups.create.descriptionTooLong", { max: FEED_GROUP_DESC_MAX })
      : null;

  const update = useMutation({
    mutationFn: (body: UpdateFeedGroupDto) => socialGroupsApi.update(group.id, body),
    onMutate: () => {
      setError(null);
      setSaved(false);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(socialKeys.groups.detail(group.id), updated);
      void queryClient.invalidateQueries({ queryKey: socialKeys.groups.lists() });
      setSaved(true);
    },
    onError: fail("groupUpdate", "update"),
  });

  const remove = useMutation({
    mutationFn: () => socialGroupsApi.remove(group.id),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setConfirmDelete(false);
      await navigate({ to: "/feed/groups", replace: true });
      queryClient.removeQueries({ queryKey: socialKeys.groups.detail(group.id) });
      // Bài trong nhóm biến khỏi Saved/News/polls/ideas ⇒ làm mới cả module.
      await queryClient.invalidateQueries({ queryKey: socialKeys.all });
    },
    onError: (err) => {
      setConfirmDelete(false);
      fail("groupDelete", "delete")(err);
    },
  });

  const hasChanges = Object.keys(changes).length > 0;
  const canSave = hasChanges && !nameError && !descError && !update.isPending;
  const nameTaken = error?.reason === "nameTaken";

  return (
    <div className="flex flex-col gap-6" data-testid="group-settings">
      <form
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) update.mutate(changes as UpdateFeedGroupDto);
        }}
      >
        <h2 className="text-sm font-semibold text-foreground">{t("groups.settings.title")}</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">{t("groups.create.name")}</span>
          <Input
            data-testid="group-settings-name"
            value={name}
            aria-invalid={Boolean(nameError || nameTaken)}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
              if (nameTaken) setError(null);
            }}
          />
          {nameError && <span className="text-xs text-destructive">{nameError}</span>}
          {nameTaken && (
            <span className="text-xs text-destructive" data-testid="group-settings-name-taken">
              {t("actionError.reason.nameTaken")}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">{t("groups.create.description")}</span>
          <textarea
            data-testid="group-settings-description"
            value={description}
            rows={3}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaved(false);
            }}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {descError && <span className="text-xs text-destructive">{descError}</span>}
        </label>
        <GroupVisibilityField
          value={visibility}
          onChange={(v) => {
            setVisibility(v);
            setSaved(false);
          }}
          name="group-settings-visibility"
        />
        {visibility !== group.visibility && (
          <p data-testid="group-settings-visibility-note" className="text-xs text-muted-foreground">
            {visibility === "private" ? t("groups.settings.toPrivateNote") : t("groups.settings.toPublicNote")}
          </p>
        )}
        {error && !nameTaken && (
          <ActionErrorBanner
            kind={error.kind}
            forbidden={error.forbidden}
            reason={error.reason}
            onDismiss={() => setError(null)}
          />
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" data-testid="group-settings-save" disabled={!canSave}>
            {update.isPending ? t("groups.settings.saving") : t("groups.settings.save")}
          </Button>
          {saved && !hasChanges && (
            <span role="status" data-testid="group-settings-saved" className="text-sm text-muted-foreground">
              {t("groups.settings.saved")}
            </span>
          )}
        </div>
      </form>

      {caps.canDelete && (
        <section
          data-testid="group-settings-danger"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-4"
        >
          <h2 className="text-sm font-semibold text-destructive">{t("groups.settings.dangerTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("groups.settings.dangerBody")}</p>
          <div>
            <Button
              size="sm"
              variant="destructive"
              data-testid="group-settings-delete"
              disabled={remove.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              {t("groups.settings.delete")}
            </Button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("groups.settings.deleteConfirmTitle", { name: group.name })}
        description={t("groups.settings.dangerBody")}
        confirmLabel={t("groups.settings.delete")}
        cancelLabel={t("groups.actions.cancel")}
        destructive
        busy={remove.isPending}
        busyLabel={t("groups.actions.working")}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
