import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateChannelRequest } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { channelsApi } from "@/lib/channels-api";
import { ChannelFormFields, emptyChannelForm, type ChannelFormState } from "./channel-form-fields";
import { useEmployeeOptions, useTeamOptions } from "./use-channel-options";

function toCreateRequest(f: ChannelFormState): CreateChannelRequest {
  const req: CreateChannelRequest = { name: f.name.trim(), platform: f.platform };
  const code = f.code.trim();
  if (code) req.code = code;
  const url = f.url.trim();
  if (url) req.url = url;
  const language = f.language.trim();
  if (language) req.language = language;
  const targetCountry = f.targetCountry.trim();
  if (targetCountry) req.targetCountry = targetCountry;
  const niche = f.niche.trim();
  if (niche) req.niche = niche;
  if (f.channelManagerId) req.channelManagerId = f.channelManagerId;
  if (f.primaryTeamId) req.primaryTeamId = f.primaryTeamId;
  return req;
}

export function CreateChannelDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ChannelFormState>(emptyChannelForm);
  const employees = useEmployeeOptions();
  const teams = useTeamOptions();

  const create = useMutation({
    mutationFn: () => channelsApi.createChannel(toCreateRequest(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["channels"] });
      setForm(emptyChannelForm);
      setOpen(false);
    },
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Thêm kênh
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Thêm kênh mới"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!form.name.trim() || create.isPending}
            >
              {create.isPending ? "Đang tạo…" : "Tạo kênh"}
            </Button>
          </>
        }
      >
        <ChannelFormFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} employees={employees} teams={teams} />
        {create.isError && (
          <p className="text-sm text-destructive">
            Tạo kênh thất bại:{" "}
            {create.error instanceof Error ? create.error.message : "Lỗi không xác định"}
          </p>
        )}
      </Dialog>
    </>
  );
}
