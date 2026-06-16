# ADR-0018: Mobile Stack — Expo Managed Workflow

**Date:** 2026-06-16  
**Status:** Accepted  
**Deciders:** MediaOS engineering team  
**Context:** G15 Mobile — first native mobile app for MediaOS (~200 staff, iOS + Android).

---

## Context

MediaOS needs a mobile app for staff (attendance check-in, schedule viewing, payslip access, media notifications). The team is TypeScript-first with no existing iOS/Swift or Android/Kotlin expertise. The API is already stable (NestJS, Zod contracts). Time-to-ship matters.

---

## Decision

Use **Expo SDK 53 (managed workflow)** with **Expo Router v4** for file-based navigation.

### Key choices

| Concern | Decision | Rationale |
|---|---|---|
| RN framework | Expo managed | No native build toolchain required; OTA updates via EAS Update |
| Navigation | Expo Router (file-based) | Mirrors Next.js/TanStack Router conventions the team already knows |
| Token storage | `expo-secure-store` | AES-256 via Android Keystore / iOS Keychain — enforces BẤT BIẾN §3 (no plaintext secrets) |
| State / data fetching | TanStack Query v5 | Matches web app version; familiar caching/invalidation patterns |
| Contracts | `@mediaos/contracts` (workspace:*) | Single Zod source of truth across api ↔ web ↔ mobile |
| API client | Fetch-based (mirrors `apps/web/src/lib/api-client.ts`) | No extra dep; envelope unwrap + Zod parse consistent with web |
| Auth flow | 2FA-aware: step 1 login → detect `twoFactorRequired` → step 2 TOTP verify | Wires to real `/auth/login` + `/auth/2fa/verify` endpoints |

---

## Alternatives Considered

### Bare React Native (without Expo)
- **Pro:** Full native module control, smaller final binary (no Expo SDK overhead).  
- **Con:** Requires Xcode + Android Studio on CI; separate native build expertise; much longer setup. No benefit at current team size.  
- **Verdict:** Rejected for M0–M2. Can migrate via `expo prebuild` (see below).

### Expo with Prebuild (bare equivalent + EAS)
- **Pro:** Full native module access while keeping Expo tooling.  
- **Con:** Loses managed simplicity; requires committing `ios/` and `android/` directories.  
- **Verdict:** Deferred — this is the **migration path** when G15-2 (push notifications via FCM) requires native config that managed workflow cannot handle.

### React Native with Expo Go only
- **Pro:** Zero install friction for testers.  
- **Con:** Cannot use expo-secure-store in Expo Go (requires development build). Unacceptable given BẤT BIẾN §3.  
- **Verdict:** Dev builds required (EAS Build or local `expo run`).

---

## FCM Integration Plan (G15-2)

Expo managed workflow supports push notifications via **expo-notifications** + **EAS Push** (Expo's FCM proxy). This covers the majority of notification use cases without native code.

**If raw FCM token access is needed** (e.g., server-to-device direct, custom channel config):
1. Run `npx expo prebuild` → generates `ios/` + `android/` directories.
2. Add `@react-native-firebase/app` + `@react-native-firebase/messaging`.
3. Update `metro.config.js` (already monorepo-aware).
4. CI moves from `expo build` → `eas build` with native runners.

This is a non-breaking migration — JS/TS code remains unchanged; only native config is added.

---

## Consequences

- **Positive:** Fastest path to working app; TypeScript throughout; shared contracts with web; secure token storage from day one.
- **Positive:** `expo-doctor` and EAS tooling provide upgrade path guidance per SDK version.
- **Negative:** Managed workflow limits some native APIs (addressable via prebuild when needed).
- **Negative:** Expo SDK version locks React Native version (currently RN 0.79.2 with SDK 53).
- **Watch:** SDK upgrades require coordinated dep bumps (Expo, RN, React versions must match SDK table).
