import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AddChannelMemberRequest, ChannelRole } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import { channelsApi } from "@/lib/channels-api";
import { CHANNEL_ROLE_LABELS, CHANNEL_ROLE_OPTIONS } from "./constants";
import { useEmployeeOptions } from "./use-channel-options";

interface AddChannelMemberDialogProps {
  channelId: string;
  open: boolean;
  onClose: () => void;
  /** userId đã là thành viên — loại khỏi dropdown. */
  excludeUserIds: string[];
}

export function AddChannelMemberDialog({
  channelId,
  open,
  onClose,
  excludeUserIds,
}: AddChannelMemberDialogProps) {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<ChannelRole | "">("");
  const [permissionLevel, setPermissionLevel] = useState("");
  const employees = useEmployeeOptions();

  useEffect(() => {
    if (open) {
      setUserId("");
      setRole("");
      setPermissionLevel("");
    }
  }, [open]);

  const excluded = new Set(excludeUserIds);
  const available = employees.filter((e) => !excluded.has(e.userId));

  const add = useMutation({
    mutationFn: () => {
      const req: AddChannelMemberRequest = { userId };
      if (role) req.roleInChannel = role;
      const lvl = permissionLevel.trim();
      if (lvl) req.permissionLevel = lvl;
      return channelsApi.addChannelMember(channelId, req);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["channels", channelId, "members"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("addMemberDialog.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("addMemberDialog.cancel")}
          </Button>
          <Button size="sm" onClick={() => add.mutate()} disabled={!userId || add.isPending}>
            {add.isPending ? t("addMemberDialog.adding") : t("common:actions.add")}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("addMemberDialog.staffLabel")}</span>
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t("addMemberDialog.staffPlaceholder")}</option>
          {available.map((e) => (
            <option key={e.userId} value={e.userId}>
              {e.userFullName ?? e.userEmail ?? e.userId}
            </option>
          ))}
        </Select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("addMemberDialog.roleLabel")}</span>
        <Select value={role} onChange={(e) => setRole(e.target.value as ChannelRole | "")}>
          <option value="">{t("addMemberDialog.rolePlaceholder")}</option>
          {CHANNEL_ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {CHANNEL_ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">{t("addMemberDialog.permissionLabel")}</span>
        <Input
          value={permissionLevel}
          onChange={(e) => setPermissionLevel(e.target.value)}
          placeholder={t("addMemberDialog.permissionPlaceholder")}
        />
      </label>

      {add.isError && (
        <p className="text-sm text-destructive">
          {t("addMemberDialog.addFailed", { detail: add.error instanceof Error ? add.error.message : t("addMemberDialog.errorUnknown") })}
        </p>
      )}
    </Dialog>
  );
}
