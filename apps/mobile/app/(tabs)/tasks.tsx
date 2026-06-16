import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import type { TaskDto } from "@mediaos/contracts";
import { useMyTasks } from "../../src/tasks/use-tasks";
import { TASK_STATUS_LABELS } from "../../src/tasks/task-constants";
import { TaskRow } from "../../src/components/task-row";

type StatusFilter = TaskDto["status"] | "all";

/** Module-level so FlatList gets a stable component identity (no per-render remount of separators). */
const RowSeparator = () => <View style={styles.separator} />;

/**
 * My Tasks — the caller's own assigned tasks (GET /tasks). Status filter chips + pull-to-refresh.
 * Tapping a row opens the task detail. The server scopes the list (RLS + assignee); the client only
 * filters what it already received.
 */
export default function MyTasksScreen() {
  const { data: tasks = [], isLoading, isError, refetch, isRefetching } = useMyTasks();
  const [filter, setFilter] = useState<StatusFilter>("all");

  const filtered = useMemo(
    () => (filter === "all" ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter],
  );

  // Only show filter chips for statuses that actually appear, plus "Tất cả".
  const presentStatuses = useMemo(() => {
    const set = new Set<TaskDto["status"]>();
    for (const t of tasks) set.add(t.status);
    return Array.from(set);
  }, [tasks]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Không tải được danh sách công việc.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void refetch()}>
          <Text style={styles.retryText}>Thử lại</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
      >
        <FilterChip label="Tất cả" active={filter === "all"} onPress={() => setFilter("all")} />
        {presentStatuses.map((s) => (
          <FilterChip
            key={s}
            label={TASK_STATUS_LABELS[s]}
            active={filter === s}
            onPress={() => setFilter(s)}
          />
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item }) => (
          <TaskRow task={item} onPress={(id) => router.push(`/task/${id}`)} />
        )}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {filter === "all" ? "Bạn chưa có công việc nào." : "Không có công việc ở trạng thái này."}
          </Text>
        }
      />
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  errorText: { fontSize: 15, color: "#dc2626" },
  retryButton: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#2563eb", borderRadius: 8 },
  retryText: { color: "#fff", fontWeight: "600" },
  filterBar: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#e5e7eb" },
  chipActive: { backgroundColor: "#2563eb" },
  chipText: { fontSize: 13, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  listContent: { padding: 12, paddingTop: 0, flexGrow: 1 },
  separator: { height: 10 },
  emptyText: { textAlign: "center", color: "#6b7280", marginTop: 48, fontSize: 15 },
});
