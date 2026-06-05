import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mediaApi } from "@/lib/media-api";

export function ProjectsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const { data: projects = [], isLoading, isError } = useQuery({
    queryKey: ["projects"],
    queryFn: mediaApi.listProjects,
  });

  const create = useMutation({
    mutationFn: () => mediaApi.createProject({ name }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["projects"] }); setName(""); },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Dự án</h1>

      <div className="flex gap-2">
        <Input placeholder="Tên dự án…" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>Tạo</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {isError && <p className="text-sm text-destructive">Không tải được dữ liệu.</p>}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {projects.map((p) => (
          <li key={p.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <Link
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                className="text-sm font-medium underline-offset-2 hover:underline"
              >
                {p.name}
              </Link>
              <span className={`text-xs ${p.status === "active" ? "text-green-600" : "text-muted-foreground"}`}>
                {p.status}
              </span>
            </div>
            {p.channels && p.channels.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {p.channels.map((c) => (
                  <span key={c.id} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {c.name} · {c.platform}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
        {projects.length === 0 && !isLoading && (
          <li className="px-4 py-3 text-sm text-muted-foreground">Chưa có dự án nào.</li>
        )}
      </ul>
    </div>
  );
}
