import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mediaApi } from "@/lib/media-api";
import type { ContentItemDto } from "@mediaos/contracts";

const STATUS_LABELS: Record<ContentItemDto["status"], string> = {
  draft: "Nháp",
  in_production: "Đang làm",
  review: "Chờ duyệt",
  approved: "Đã duyệt",
  published: "Đã đăng",
};

export function ProjectDetailPage() {
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const qc = useQueryClient();
  const [title, setTitle] = useState("");

  const { data: content = [], isLoading, isError } = useQuery({
    queryKey: ["projects", projectId, "content"],
    queryFn: () => mediaApi.listContent(projectId),
  });

  const create = useMutation({
    mutationFn: () => mediaApi.createContent(projectId, { title, contentType: "video" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects", projectId, "content"] });
      setTitle("");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Nội dung dự án</h1>

      <div className="flex gap-2">
        <Input
          placeholder="Tiêu đề video…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>
          Tạo video
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {content.map((item) => (
          <li key={item.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground capitalize">{item.contentType}</p>
            </div>
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[item.status]}</span>
          </li>
        ))}
        {content.length === 0 && !isLoading && (
          <li className="px-4 py-3 text-sm text-muted-foreground">Chưa có nội dung nào.</li>
        )}
      </ul>
    </div>
  );
}
