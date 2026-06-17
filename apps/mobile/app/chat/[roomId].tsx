import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chatApi } from "../../src/api/chat-api";
import type { ChatMessageDto } from "@mediaos/contracts";

/**
 * Chat message thread for a single room.
 * Messages are ordered by seq (server-assigned monotonic counter).
 */
export default function ChatRoomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["chat", "rooms", roomId, "messages"],
    queryFn: () => chatApi.listMessages(roomId),
    enabled: Boolean(roomId),
  });

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      chatApi.sendMessage(roomId, { body, messageType: "text" }),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["chat", "rooms", roomId, "messages"] });
    },
  });

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      {messages.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Chưa có tin nhắn. Hãy gửi tin đầu tiên!</Text>
        </View>
      ) : (
        <FlatList
          data={[...messages].reverse()}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.list}
          inverted
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Nhập tin nhắn..."
          multiline
          maxLength={4000}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!draft.trim() || sendMutation.isPending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || sendMutation.isPending}
          accessibilityRole="button"
          accessibilityLabel="Gửi tin nhắn"
        >
          <Text style={styles.sendText}>Gửi</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: ChatMessageDto }) {
  return (
    <View style={styles.bubble}>
      <Text style={styles.senderName}>{message.senderName ?? "Ẩn danh"}</Text>
      <Text style={styles.messageBody}>{message.body}</Text>
      <Text style={styles.messageTime}>
        {new Date(message.createdAt).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  list: { padding: 12, gap: 8 },
  bubble: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    maxWidth: "80%",
    alignSelf: "flex-start",
  },
  senderName: { fontSize: 12, fontWeight: "600", color: "#2563eb", marginBottom: 2 },
  messageBody: { fontSize: 14, color: "#111827", lineHeight: 20 },
  messageTime: { fontSize: 11, color: "#9ca3af", marginTop: 4, textAlign: "right" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 8,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 100,
    backgroundColor: "#f9fafb",
  },
  sendButton: {
    backgroundColor: "#2563eb",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendButtonDisabled: { backgroundColor: "#93c5fd" },
  sendText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  emptyText: { fontSize: 14, color: "#6b7280", textAlign: "center" },
});
