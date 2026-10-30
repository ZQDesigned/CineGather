import icon from "../../assets/icon.png";
import { useState } from "react";
import {
  View,
  Text,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { runtime } from "../runtime";
import { useRuntime, useSession } from "./use-runtime";
import { styles, colors, Field, Button } from "./ui";
export function Auth() {
  const session = useSession(),
    state = useRuntime();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: 26,
            gap: 24,
          }}
        >
          <View style={{ alignItems: "center", gap: 18 }}>
            <Image
              source={icon}
              style={{ width: 84, height: 84, borderRadius: 22 }}
            />
            <Text style={styles.title}>相聚，从映聚开始</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.heading}>
              {mode === "login" ? "登录账号" : "注册账号"}
            </Text>
            <Field
              label="用户名"
              testID="auth-username"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              value={username}
              onChangeText={setUsername}
            />
            {mode === "register" && (
              <Field
                label="昵称"
                value={name}
                onChangeText={setName}
                maxLength={32}
              />
            )}
            <Field
              label="密码"
              testID="auth-password"
              secureTextEntry
              textContentType={mode === "login" ? "password" : "newPassword"}
              value={password}
              onChangeText={setPassword}
            />
            {(session.error || state.error) && (
              <Text accessibilityRole="alert" style={{ color: colors.danger }}>
                {session.error ?? state.error}
              </Text>
            )}
            <Button
              primary
              testID="auth-submit"
              disabled={
                !username.trim() ||
                !password ||
                session.status === "signing-in" ||
                session.status === "restoring" ||
                (mode === "register" && !name.trim())
              }
              onPress={async () => {
                await runtime.authenticate(mode, username, password, name);
                setPassword("");
              }}
            >
              {session.status === "restoring"
                ? "正在恢复登录…"
                : mode === "login"
                  ? "登录映聚"
                  : "创建账号"}
            </Button>
            {session.canRetryRestore && (
              <Button onPress={() => runtime.session.restore()}>
                重试恢复登录
              </Button>
            )}
            {state.registration && (
              <Button
                onPress={() => {
                  runtime.clearError();
                  setMode(mode === "login" ? "register" : "login");
                }}
              >
                {mode === "login" ? "注册新账号" : "已有账号，返回登录"}
              </Button>
            )}
          </View>
          <Text style={[styles.muted, { textAlign: "center" }]}>
            映聚手机版 v{runtime.version}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
