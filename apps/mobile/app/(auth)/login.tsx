import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { loginRequestSchema, twoFactorChallengeSchema } from "@mediaos/contracts";
import { authApi } from "../../src/auth/auth-api";
import { useAuth } from "../../src/auth/auth-context";

type Step = "credentials" | "totp";

/**
 * Login screen — 2FA-aware two-step flow:
 *   Step 1 (credentials): companySlug + email + password → POST /auth/login
 *     • If server returns AuthTokens      → save + navigate to home.
 *     • If server returns TwoFactorChallenge → advance to step 2.
 *   Step 2 (totp): TOTP code + stored challengeToken → POST /auth/2fa/verify → save + navigate.
 */
export default function LoginScreen() {
  const { onLoginSuccess } = useAuth();

  // Step 1 fields
  const [companySlug, setCompanySlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 fields
  const [step, setStep] = useState<Step>("credentials");
  const [challengeToken, setChallengeToken] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const [isLoading, setIsLoading] = useState(false);

  async function handleCredentialsSubmit() {
    const parsed = loginRequestSchema.safeParse({ companySlug, email, password });
    if (!parsed.success) {
      Alert.alert("Lỗi", parsed.error.errors[0]?.message ?? "Thông tin không hợp lệ.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await authApi.login(parsed.data);

      // Discriminate union: TwoFactorChallenge has twoFactorRequired: true
      const maybeChallenge = twoFactorChallengeSchema.safeParse(response);
      if (maybeChallenge.success) {
        setChallengeToken(maybeChallenge.data.challengeToken);
        setStep("totp");
      } else {
        // AuthTokens — login complete
        await onLoginSuccess(response as Parameters<typeof onLoginSuccess>[0]);
        router.replace("/(tabs)/");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Đăng nhập thất bại.";
      Alert.alert("Đăng nhập thất bại", message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleTotpSubmit() {
    if (totpCode.trim().length < 6) {
      Alert.alert("Lỗi", "Mã xác thực phải có ít nhất 6 ký tự.");
      return;
    }

    setIsLoading(true);
    try {
      const tokens = await authApi.verifyTwoFactor(challengeToken, totpCode.trim());
      await onLoginSuccess(tokens);
      router.replace("/(tabs)/");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Mã xác thực không đúng.";
      Alert.alert("Xác thực thất bại", message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>MediaOS</Text>

        {step === "credentials" ? (
          <>
            <Text style={styles.subtitle}>Đăng nhập</Text>

            <TextInput
              style={styles.input}
              placeholder="Company slug"
              autoCapitalize="none"
              autoCorrect={false}
              value={companySlug}
              onChangeText={setCompanySlug}
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Mật khẩu"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleCredentialsSubmit}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Đăng nhập</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>Xác thực 2 bước</Text>
            <Text style={styles.hint}>
              Nhập mã TOTP 6 số từ ứng dụng xác thực, hoặc mã dự phòng.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Mã xác thực"
              keyboardType="number-pad"
              autoCorrect={false}
              maxLength={40}
              value={totpCode}
              onChangeText={setTotpCode}
            />

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleTotpSubmit}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Xác nhận</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                setStep("credentials");
                setTotpCode("");
              }}
              disabled={isLoading}
            >
              <Text style={styles.backButtonText}>← Quay lại</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#1a1a1a",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#444",
    textAlign: "center",
    marginBottom: 24,
  },
  hint: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 20,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  backButton: {
    marginTop: 16,
    alignItems: "center",
  },
  backButtonText: {
    color: "#2563eb",
    fontSize: 14,
  },
});
