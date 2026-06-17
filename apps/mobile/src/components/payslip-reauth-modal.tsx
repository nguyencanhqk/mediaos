import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { PayslipDto } from "@mediaos/contracts";
import { errorMessage } from "../api/client";
import { revealOwnPayslip } from "../hr/use-payslip-reauth";

interface PayslipReauthModalProps {
  /** When set, the modal is open for this payslip id; null = closed. */
  payslipId: string | null;
  onClose: () => void;
  /**
   * Receives the revealed PayslipDto ONE TIME — the caller keeps it ephemeral. This modal does NOT
   * retain the detail (money): it hands it through via callback and forgets. Mirror of the web
   * PayslipReauthModal (G12-FE).
   */
  onRevealed: (detail: PayslipDto) => void;
  /** Injectable for tests; defaults to the real reauth → getOwn pipeline (never caches money). */
  reveal?: (id: string, password: string) => Promise<PayslipDto>;
}

/**
 * PayslipReauthModal (mobile) — step-up gate before the caller's OWN payslip money is shown.
 *
 * BẤT BIẾN #3 (mirror web):
 *  - Step-up via PASSWORD ONLY (no OTP — payslip uses password re-auth, not 2FA).
 *  - reveal() runs reauthOwn → getOwn as a DIRECT fetch (never cached). The window response is a
 *    server-side window, NOT a token — nothing is stored.
 *  - Password (sensitive factor) is cleared on close/unmount.
 *  - onRevealed hands the detail to the caller; this modal does NOT retain it.
 *  - On failure the user sees a generic message (errorMessage → generic on 403); raw server detail
 *    is never surfaced.
 */
export function PayslipReauthModal({
  payslipId,
  onClose,
  onRevealed,
  reveal = revealOwnPayslip,
}: PayslipReauthModalProps) {
  const open = payslipId !== null;
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear the sensitive factor whenever the modal closes (including unmount via open=false).
  useEffect(() => {
    if (!open) {
      setPassword("");
      setError(null);
      setLoading(false);
    }
  }, [open]);

  async function submit() {
    if (!payslipId || !password.trim() || loading) return;
    setError(null);
    setLoading(true);
    let detail: PayslipDto;
    try {
      detail = await reveal(payslipId, password);
    } catch (err) {
      // errorMessage maps any 403 to the generic permission line — no server detail leaks.
      setError(errorMessage(err));
      setLoading(false);
      return;
    }
    // Clear the factor BEFORE handing off; close BEFORE delivering data so a throwing consumer
    // can't leave the modal stuck open.
    setLoading(false);
    setPassword("");
    onClose();
    onRevealed(detail);
  }

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Xác thực để xem chi tiết</Text>
          <Text style={styles.description}>
            Phiếu lương chứa thông tin nhạy cảm. Vui lòng nhập lại mật khẩu để xem.
          </Text>

          <Text style={styles.label}>Mật khẩu</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Mật khẩu"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            autoFocus
          />

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.ghostButton}
              onPress={onClose}
              disabled={loading}
              accessibilityRole="button"
            >
              <Text style={styles.ghostText}>Huỷ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, (!password.trim() || loading) && styles.disabled]}
              onPress={() => void submit()}
              disabled={!password.trim() || loading}
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>Xác nhận</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 20, gap: 8 },
  title: { fontSize: 18, fontWeight: "700", color: "#111827" },
  description: { fontSize: 13, color: "#6b7280", marginBottom: 4 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151", marginTop: 4 },
  input: {
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  error: { fontSize: 13, color: "#dc2626", marginTop: 4 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  ghostButton: { paddingHorizontal: 14, paddingVertical: 10 },
  ghostText: { color: "#6b7280", fontWeight: "600" },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.6 },
});
