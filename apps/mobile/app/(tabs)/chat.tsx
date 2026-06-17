import React from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { chatApi } from "../../src/api/chat-api";
import type { ChatRoomDto } from "@mediaos/contracts";

/**
 * Chat rooms list — shows rooms the caller is a member of.
 * Tapping a room navigates to the full message thread.
 */
export default function ChatScreen() {
  const { data: rooms = [], isLoading, isError } = useQuery({
    queryKey: ["chat", "rooms"],
    queryFn: () => chatApi.listRooms(),
  });

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
        <Text style={styles.errorText}>Không thể tải danh sách phòng chat.</Text>
      </View>
    );
  }

  if (rooms.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Chưa có phòng chat nào.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <RoomRow room={item} onPress={() => router.push(`/chat/${item.id}`)} />
        )}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

function RoomRow({ room, onPress }: { room: ChatRoomDto; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowContent}>
        <Text style={styles.roomName}>{room.name}</Text>
        <Text style={styles.roomType}>{room.roomType}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  list: { padding: 12, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
  },
  rowContent: { flex: 1 },
  roomName: { fontSize: 16, fontWeight: "600", color: "#111827" },
  roomType: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  chevron: { fontSize: 24, color: "#9ca3af" },
  errorText: { fontSize: 14, color: "#dc2626", textAlign: "center" },
  emptyText: { fontSize: 14, color: "#6b7280", textAlign: "center" },
});
