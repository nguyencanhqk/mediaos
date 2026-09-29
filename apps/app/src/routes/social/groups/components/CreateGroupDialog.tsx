/**
 * S16-SOCIAL-FE-2B — hộp tạo nhóm (`031`, cặp `create:feed-group`; plan D7).
 *
 * Kiểm phía client mirror `createFeedGroupSchema` (tên trim 1–255 · mô tả trim ≤2000 · chế độ bắt
 * buộc) để người dùng thấy lý do sớm; 409 tên trùng của server vẫn được hiện ngay dưới ô tên. Mô tả
 * rỗng ⇒ BỎ khoá (server lưu `""` thành chuỗi rỗng chứ không `null`). Lỗi thì GIỮ nguyên mọi thứ đã
 * nhập — không dọn form trước khi server xác nhận.
 */
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, Dialog, Input } from "@mediaos/ui";
import { socialGroupsApi, socialKeys } from "@mediaos/web-core";
import {
  FEED_GROUP_DESC_MAX,
  FEED_GROUP_NAME_MAX,
  type CreateFeedGroupDto,
} from "@mediaos/contracts";
import { ActionErrorBanner } from "../../feed/components/ActionErrorBanner";
import { useGroupErrorState } from "../lib/use-group-membership";
import { GroupVisibilityField } from "./GroupVisibilityField";

interface CreateGroupDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateGroupDialog({ open, onClose }: CreateGroupDialogProps): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, setError, fail } = useGroupErrorState();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [visibility, setVisibility] = React.useState<"public" | "private">("public");
  const [touched, setTouched] = React.useState(false);

  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const nameError =
    trimmedName.length === 0
      ? t("groups.create.nameRequired")
      : trimmedName.length > FEED_GROUP_NAME_MAX
        ? t("groups.create.nameTooLong", { max: FEED_GROUP_NAME_MAX })
        : null;
  const descError =
    trimmedDesc.length > FEED_GROUP_DESC_MAX
      ? t("groups.create.descriptionTooLong", { max: FEED_GROUP_DESC_MAX })
      : null;

  const mutation = useMutation({
    mutationFn: (body: CreateFeedGroupDto) => socialGroupsApi.create(body),
    onMutate: () => setError(null),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.groups.allOf() });
      setName("");
      setDescription("");
      setVisibility("public");
      setTouched(false);
      onClose();
      void navigate({ to: "/feed/groups/$groupId", params: { groupId: created.id } });
    },
    onError: fail("groupCreate", "create"),
  });

  const submit = (): void => {
    setTouched(true);
    if (nameError || descError || mutation.isPending) return;
    mutation.mutate({
      name: trimmedName,
      visibility,
      ...(trimmedDesc.length > 0 ? { description: trimmedDesc } : {}),
    });
  };

  const nameTaken = error?.reason === "nameTaken";

  return (
    <Dialog
      open={open}
      onClose={mutation.isPending ? () => {} : onClose}
      title={t("groups.create.title")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("groups.actions.cancel")}
          </Button>
          <Button
            type="button"
            data-testid="group-create-submit"
            onClick={submit}
            disabled={mutation.isPending || (touched && Boolean(nameError || descError))}
          >
            {mutation.isPending ? t("groups.create.submitting") : t("groups.create.submit")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">{t("groups.create.name")}</span>
          <Input
            data-testid="group-create-name"
            value={name}
            maxLength={FEED_GROUP_NAME_MAX + 50}
            aria-invalid={Boolean((touched && nameError) || nameTaken)}
            onChange={(e) => {
              setName(e.target.value);
              if (nameTaken) setError(null);
            }}
          />
          {touched && nameError && (
            <span className="text-xs text-destructive" data-testid="group-create-name-error">
              {nameError}
            </span>
          )}
          {nameTaken && (
            <span className="text-xs text-destructive" data-testid="group-create-name-taken">
              {t("actionError.reason.nameTaken")}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">{t("groups.create.description")}</span>
          <textarea
            data-testid="group-create-description"
            value={description}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {descError && <span className="text-xs text-destructive">{descError}</span>}
        </label>
        <GroupVisibilityField
          value={visibility}
          onChange={setVisibility}
          name="group-create-visibility"
        />
        {error && !nameTaken && (
          <ActionErrorBanner
            kind={error.kind}
            forbidden={error.forbidden}
            reason={error.reason}
            onDismiss={() => setError(null)}
          />
        )}
      </form>
    </Dialog>
  );
}
