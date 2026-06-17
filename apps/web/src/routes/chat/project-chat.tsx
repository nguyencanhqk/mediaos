import { useEffect, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";
import { Input } from "@mediaos/ui";
import { chatApi } from "@/lib/chat-api";
import { projectsApi } from "@/lib/projects-api";
import type { ChatMessageDto } from "@mediaos/contracts";

export function ProjectChatPage() {
  const { t } = useTranslation("chat");
  const { projectId } = useParams({ from: "/chat/projects/$projectId" });
  const [body, setBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.getProject(projectId),
  });

  const { data: rooms } = useQuery({
    queryKey: ["chat", "rooms"],
    queryFn: () => chatApi.listRooms(),
  });

  const room = rooms?.find((r) => r.refId === projectId);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["chat", "messages", room?.id],
    queryFn: () => chatApi.getMessages(room!.id),
    enabled: !!room?.id,
    refetchInterval: 5_000,
  });

  // Truyền roomId qua variables — tránh non-null assertion trên closure room
  const send = useMutation({
    mutationFn: ({ roomId, text }: { roomId: string; text: string }) =>
      chatApi.sendMessage(roomId, { body: text, messageType: "text" }),
    onSuccess: (_, { roomId }) => {
      void qc.invalidateQueries({ queryKey: ["chat", "messages", roomId] });
      setBody("");
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !room?.id) return;
    send.mutate({ roomId: room.id, text: body.trim() });
  };

  if (!room && !isLoading) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-14 items-center border-b border-border px-6">
          <h1 className="font-semibold">Chat — {project?.name ?? projectId}</h1>
        </header>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("chat.noRoom")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
        <h1 className="font-semibold">Chat — {project?.name ?? projectId}</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {isLoading && (
          <p className="text-sm text-muted-foreground">{t("chat.loading")}</p>
        )}
        {messages?.map((msg: ChatMessageDto) => (
          <div key={msg.id} className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {(msg.senderName ?? "?")[0]?.toUpperCase()}
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{msg.senderName ?? msg.senderId}</span>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(msg.createdAt).toLocaleString("vi-VN", {
                    timeStyle: "short",
                    dateStyle: "short",
                  })}
                </span>
              </div>
              <p className="mt-0.5 text-sm leading-relaxed">{msg.body}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="flex shrink-0 items-center gap-2 border-t border-border px-6 py-3"
      >
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("chat.messagePlaceholder")}
          className="flex-1"
          disabled={send.isPending || !room?.id}
        />
        <Button type="submit" size="sm" disabled={!body.trim() || send.isPending || !room?.id}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
