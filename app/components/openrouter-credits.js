"use client";

import { useEffect, useState } from "react";

export const creditsBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "3px 9px",
  borderRadius: 999,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--note-border-subtle)",
  background: "var(--note-surface-muted)",
  fontSize: 12,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
  color: "var(--note-text-secondary)",
  lineHeight: 1.2,
  boxSizing: "border-box",
};

function WalletIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}

const wrap = {
  marginTop: "auto",
  paddingTop: 8,
  flexShrink: 0,
};

const pill = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  textAlign: "left",
  padding: "11px 12px",
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  fontFamily: "inherit",
  background: "transparent",
  color: "var(--note-sidebar-pill-fg)",
  border: "none",
  cursor: "pointer",
  textDecoration: "none",
  transition: "background 0.15s, color 0.15s",
  boxSizing: "border-box",
};

const iconWrap = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  color: "var(--note-sidebar-pill-icon)",
};

const amount = {
  flex: 1,
  minWidth: 0,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

export function OpenRouterCredits({ style }) {
  const [mark, setMark] = useState(null);
  const [tip, setTip] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/openrouter/credits");
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setMark("—");
          setTip(typeof j?.error === "string" ? j.error : "");
          return;
        }

        const display = j.displayRemaining;
        if (typeof display === "number" && Number.isFinite(display)) {
          const v = `$${fmtCredits(display)}`;
          setMark(v);
          setTip(v);
        } else {
          setMark("∞");
          setTip("No key spending cap");
        }
      } catch {
        if (!cancelled) {
          setMark("—");
          setTip("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = mark === null ? "…" : mark;

  return (
    <div style={{ ...wrap, ...style }}>
      <a
        className="sidebar-credits-pill"
        href="https://openrouter.ai/credits"
        target="_blank"
        rel="noopener noreferrer"
        style={pill}
        title={tip || "OpenRouter credits"}
        aria-label={
          tip
            ? `OpenRouter credits, ${tip}`
            : "OpenRouter credits (opens in new tab)"
        }
      >
        <span style={iconWrap}>
          <WalletIcon />
        </span>
        <span style={amount} aria-live="polite">
          {shown}
        </span>
      </a>
    </div>
  );
}

function fmtCredits(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const x = Math.round(n * 100) / 100;
  if (Number.isInteger(x)) return String(x);
  const s = x.toFixed(2);
  return s.replace(/\.?0+$/, "") || "0";
}
