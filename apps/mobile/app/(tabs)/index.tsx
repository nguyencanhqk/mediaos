import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../../src/auth/auth-context";

/**
 * Home screen (M0 placeholder).
 * Confirms login worked: shows user email + company ID.
 * Full screens (schedule, payroll, media) come in M1+.
 */
export default function HomeScreen() {
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace("/(auth)/login");
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>MediaOS Mobile</Text>
      <Text style={styles.label}>Đăng nhập thành công ✓</Text>

      {user && (
        <View style={styles.card}>
          <Text style={styles.field}>
            <Text style={styles.fieldLabel}>Email: </Text>
            {user.email}
          </Text>
          <Text style={styles.field}>
            <Text style={styles.fieldLabel}>Tên: </Text>
            {user.fullName ?? "(chưa đặt)"}
          </Text>
          <Text style={styles.field}>
            <Text style={styles.fieldLabel}>Company ID: </Text>
            {user.companyId}
          </Text>
          <Text style={styles.field}>
            <Text style={styles.fieldLabel}>Trạng thái: </Text>
            {user.status}
          </Text>
        </View>
      )}

      <Text style={styles.todo}>
        Màn hình nghiệp vụ (lịch, chấm công, bảng lương, media) sẽ được thêm từ M1.
      </Text>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Đăng xuất</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#f5f5f5",
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  label: {
    fontSize: 16,
    color: "#16a34a",
    marginBottom: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    gap: 8,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  field: {
    fontSize: 14,
    color: "#374151",
  },
  fieldLabel: {
    fontWeight: "600",
  },
  todo: {
    fontSize: 13,
    color: "#6b7280",
    fontStyle: "italic",
    marginBottom: 32,
    lineHeight: 18,
  },
  logoutButton: {
    backgroundColor: "#dc2626",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  logoutText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
});
