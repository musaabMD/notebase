import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--note-page-bg, #fafafa)",
        color: "var(--note-text, #111)",
        fontFamily:
          "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
      }}
    >
      <Suspense fallback={<div style={{ width: "100%", maxWidth: 360, minHeight: 280 }} />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
