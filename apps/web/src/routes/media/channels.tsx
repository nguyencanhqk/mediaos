import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mediaApi } from "@/lib/media-api";
import type { ChannelPlatform } from "@mediaos/contracts";

const PLATFORMS: ChannelPlatform[] = ["youtube", "tiktok", "facebook", "instagram"];

export function ChannelsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<ChannelPlatform>("youtube");

  const { data: channels = [], isLoading, isError } = useQuery({
    queryKey: ["channels"],
    queryFn: mediaApi.listChannels,
  });

  const create = useMutation({
    mutationFn: () => mediaApi.createChannel({ name, platform }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["channels"] }); setName(""); },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Kênh</h1>

      <div className="flex gap-2">
        <Input placeholder="Tên kênh…" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as ChannelPlatform)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>Thêm</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {channels.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="font-medium">{c.name}</span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground capitalize">{c.platform}</span>
              <span className={`text-xs ${c.status === "active" ? "text-green-600" : "text-muted-foreground"}`}>{c.status}</span>
            </div>
          </li>
        ))}
        {channels.length === 0 && !isLoading && (
          <li className="px-4 py-3 text-sm text-muted-foreground">Chưa có kênh nào.</li>
        )}
      </ul>
    </div>
  );
}
