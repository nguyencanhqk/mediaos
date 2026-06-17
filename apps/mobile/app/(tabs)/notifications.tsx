import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationApi } from "../../src/api/notification-api";
import type { NotificationDto } from "@mediaos/contracts";

/**
 * Notification inbox — lists notifications with unread badge, tap-to-mark-read,
 * mark-all-read button, and a mandatory-acknowledgement modal for announcement types.
 */
export default function NotificationsScreen() {
  const qc = useQueryClient();
  const [mandatoryNotif, setMandatoryNotif] = useState<NotificationDto | null>(null);

  const { data: notifications = [], isLoading, isError } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationApi.list(),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
    },
  });

  const handlePress = useCallback(
    (notif: NotificationDto) => {
      // "announcement" (general) notifications that are unread prompt the mandatory modal.
      if (!notif.isRead && notif.type === "general") {
        setMandatoryNotif(notif);
        return;
      }
      if (!notif.isRead) {
        markReadMutation.mutate(notif.id);
      }
    },
    [markReadMutation],
  );

  const handleAcknowledge = useCallback(() => {
    if (mandatoryNotif) {
      markReadMutation.mutate(mandatoryNotif.id);
      setMandatoryNotif(null);
    }
  }, [mandatoryNotif, markReadMutation]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Không thể tải thông báo. Vui lòng thử lại.</Text>
      </View>
    );
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.header}>
        <Text style={styles.title}>
          Thông báo{unreadCount > 0 ? ` (${unreadCount} chưa đọc)` : ""}
        </Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            onPress={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
          >
            <Text style={styles.markAllText}>Đọc tất cả</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Empty state */}
      {notifications.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Không có thông báo nào.</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationRow notif={item} onPress={() => handlePress(item)} />
          )}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Mandatory acknowledgement modal */}
      <Modal
        visible={mandatoryNotif !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          /* Intentionally no-op — user MUST tap the button */
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Thông báo quan trọng</Text>
            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalBody}>{mandatoryNotif?.body}</Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={handleAcknowledge}
              accessibilityRole="button"
            >
              <Text style={styles.modalButtonText}>Đã hiểu</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function NotificationRow({
  notif,
  onPress,
}: {
  notif: NotificationDto;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, !notif.isRead && styles.rowUnread]}
      onPress={onPress}
      accessibilityRole="button"
    >
      {!notif.isRead && <View style={styles.unreadDot} />}
      <View style={styles.rowContent}>
        <Text style={styles.rowBody} numberOfLines={2}>
          {notif.body}
        </Text>
        <Text style={styles.rowDate}>
          {new Date(notif.createdAt).toLocaleString("vi-VN")}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  title: { fontSize: 18, fontWeight: "700", color: "#111827" },
  markAllText: { fontSize: 14, color: "#2563eb", fontWeight: "600" },
  list: { padding: 12, gap: 8 },
  row: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    alignItems: "flex-start",
    gap: 10,
  },
  rowUnread: { backgroundColor: "#eff6ff" },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2563eb",
    marginTop: 6,
    flexShrink: 0,
  },
  rowContent: { flex: 1 },
  rowBody: { fontSize: 14, color: "#111827", lineHeight: 20 },
  rowDate: { fontSize: 12, color: "#6b7280", marginTop: 4 },
  errorText: { fontSize: 14, color: "#dc2626", textAlign: "center" },
  emptyText: { fontSize: 14, color: "#6b7280", textAlign: "center" },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxHeight: "80%",
    gap: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  modalScroll: { maxHeight: 200 },
  modalBody: { fontSize: 15, color: "#374151", lineHeight: 22 },
  modalButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  modalButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
