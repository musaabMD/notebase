"use client";

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from "react";
import {
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  DEFAULT_THEME_ID,
  getThemePreview,
} from "./theme-definitions";
import {
  DEFAULT_VOICE_NOTE_MODEL,
  VOICE_NOTE_MODEL_KEY,
  VOICE_NOTE_MODEL_PRESETS,
  formatVoiceModelIdForUi,
} from "./voice-openrouter";
import dynamic from "next/dynamic";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useConvexDeploymentUrl } from "./convex-client-provider";

const themeUi = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
    marginTop: 12,
  },
  card: {
    borderRadius: 12,
    borderStyle: "solid",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    background: "var(--note-surface)",
    transition: "border-color 0.15s, box-shadow 0.15s",
    boxShadow: "var(--note-card-shadow)",
  },
  cardPreviewRow: {
    display: "flex",
    gap: 8,
    alignItems: "stretch",
    minHeight: 52,
  },
  cardSwatch: {
    width: 20,
    borderRadius: 6,
    flexShrink: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: 1.25,
    textAlign: "left",
  },
  cardAccentBar: {
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    width: "42%",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--note-text-tertiary)",
    margin: "18px 0 0",
  },
};

/* ─── helpers ─────────────────────────────────────── */
const fmt = (d) => {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000)
    return new Date(d).toLocaleDateString("en-US", { weekday: "long" });
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

const hl = (text, q) => {
  if (!q.trim()) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  const isMatch = (p) => new RegExp(`^${escaped}$`, "i").test(p);
  return text.split(re).map((p, i) =>
    isMatch(p) ? (
      <mark
        key={i}
        style={{
          background: "var(--note-highlight-bg)",
          borderRadius: 3,
          padding: "0 2px",
          color: "var(--note-highlight-fg)",
        }}
      >
        {p}
      </mark>
    ) : (
      p
    )
  );
};

/** Snippet around first case-insensitive match so body hits are visible while searching. */
const excerptAroundMatch = (content, q, before = 48, after = 120) => {
  const qt = q.trim();
  if (!qt) return null;
  const lower = content.toLowerCase();
  const qi = qt.toLowerCase();
  const idx = lower.indexOf(qi);
  if (idx < 0) return null;
  const start = Math.max(0, idx - before);
  const end = Math.min(content.length, idx + qt.length + after);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return prefix + content.slice(start, end) + suffix;
};

/**
 * Avoid duplicating the title into the body: first line → title, rest → body;
 * single line → up to 6 words as title, remainder as body only (no full-text duplicate).
 */
function titleAndBodyFromPlainText(text) {
  const trimmed = text.trim();
  if (!trimmed) return { title: "Untitled", content: "" };
  const nl = trimmed.indexOf("\n");
  if (nl !== -1) {
    const first = trimmed.slice(0, nl).trim();
    const rest = trimmed.slice(nl + 1).trimEnd();
    const title = (first || "Untitled").slice(0, 200);
    return { title, content: rest };
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  const k = 6;
  if (words.length <= k) {
    return { title: words.join(" "), content: "" };
  }
  return {
    title: `${words.slice(0, k).join(" ")}…`,
    content: words.slice(k).join(" "),
  };
}

/** Sidebar filter slugs — cannot be used as notebook tags from #hashtags. */
const RESERVED_NOTEBOOK_SLUGS = new Set(["all", "images", "files"]);

/**
 * First `#slug` in title or body (after start-of-text or whitespace) becomes the notebook tag.
 * Slugs are [a-zA-Z0-9_-]+, stored lowercase. Reserved names are ignored (see RESERVED_NOTEBOOK_SLUGS).
 */
function tagFromHashtagInNoteText(title, content) {
  const text = `${title ?? ""}\n${content ?? ""}`;
  const re = /(?:^|[\s])#([a-zA-Z0-9_-]+)/g;
  const m = re.exec(text);
  if (!m) return "";
  const raw = m[1].toLowerCase();
  if (RESERVED_NOTEBOOK_SLUGS.has(raw)) return "";
  return raw;
}

function mapConvexNoteToClient(doc) {
  return {
    id: doc._id,
    tag: doc.tag,
    title: doc.title,
    content: doc.content,
    createdAt: new Date(doc.createdAt),
    pinned: doc.pinned,
    attachments: (doc.attachments ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      mime: a.mime,
      storageId: a.storageId,
      url: a.url,
      dataUrl: a.url ?? a.dataUrl,
    })),
    contentHistory: doc.contentHistory ?? [],
  };
}

function attachmentsForConvex(list) {
  return (list ?? [])
    .filter((a) => a.storageId)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      mime: a.mime,
      storageId: a.storageId,
    }));
}

async function uploadFileToConvexStorage(file, getUploadUrl) {
  const postUrl = await getUploadUrl();
  const res = await fetch(postUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
  return (await res.text()).trim();
}

const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

const fileToAttachment = (file) =>
  new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error("File too large (max 6 MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        kind: file.type.startsWith("image/") ? "image" : "file",
        name: file.name || "Attachment",
        mime: file.type || "",
        dataUrl: reader.result,
      });
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });

const mergeFilesFromDataTransfer = (dt) => {
  if (!dt) return [];
  const list = [];
  if (dt.files?.length) list.push(...Array.from(dt.files));
  if (dt.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) list.push(f);
      }
    }
  }
  const seen = new Set();
  return list.filter((f) => {
    const k = `${f.name}-${f.size}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/* ─── icons ───────────────────────────────────────── */
const MicIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);
const StopIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12">
    <rect x="0" y="0" width="12" height="12" rx="2.5" fill="currentColor" />
  </svg>
);
const SearchIcon = ({ active }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    style={{ color: active ? "var(--note-text)" : "var(--note-search-icon-inactive)" }}
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const CloseIcon = ({ size = 11 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const TrashIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
);
const MenuIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

const ChevronDownIcon = ({ open }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className="app-section-chevron"
    style={{
      flexShrink: 0,
      transform: open ? "rotate(-180deg)" : "none",
      transition: "transform 0.2s ease",
    }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Bookmark — outline style to match trash; stronger stroke when pinned. */
const BookmarkIcon = ({ filled }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={filled ? 2.35 : 2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
  </svg>
);

function TagNavIcon({ tag }) {
  const p = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  switch (tag) {
    case "all":
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "images":
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 15l-5-5-4 4-2-2-4 4" />
        </svg>
      );
    case "files":
      return (
        <svg {...p}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8M16 17H8M10 9H8" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

function TrafficLights({ onRed, onYellow, onGreen }) {
  return (
    <div style={s.trafficRow} role="group" aria-label="Window controls">
      <button
        type="button"
        className="traffic-light-hit"
        style={s.trafficLightBtn}
        onClick={onRed}
        aria-label="Close"
      >
        <span
          className="traffic-dot-visual"
          style={{ ...s.trafficDot, background: "#FF5F57" }}
        />
      </button>
      <button
        type="button"
        className="traffic-light-hit"
        style={s.trafficLightBtn}
        onClick={onYellow}
        aria-label="Minimize"
      >
        <span
          className="traffic-dot-visual"
          style={{ ...s.trafficDot, background: "#FEBC2E" }}
        />
      </button>
      <button
        type="button"
        className="traffic-light-hit"
        style={s.trafficLightBtn}
        onClick={onGreen}
        aria-label="Full screen"
      >
        <span
          className="traffic-dot-visual"
          style={{ ...s.trafficDot, background: "#28C840" }}
        />
      </button>
    </div>
  );
}

function SettingsGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

/* ─── data ────────────────────────────────────────── */
/** Sidebar items that filter the list but are not notebook tags on notes. */
const FILTER_ONLY_TAGS = new Set(["images", "files"]);

function noteMatchesSidebarTag(note, tag) {
  if (tag === "all") return true;
  if (tag === "images")
    return (note.attachments ?? []).some((a) => a.kind === "image");
  if (tag === "files")
    return (note.attachments ?? []).some((a) => a.kind === "file");
  return (note.tag || "").toLowerCase() === tag;
}

/** Default notebook tag for new notes when sidebar is All or a filter-only pill. */
function notebookTagFromActive(activeTag) {
  if (activeTag === "all" || FILTER_ONLY_TAGS.has(activeTag)) return "";
  return activeTag;
}

function sidebarTagMenuLabel(t) {
  if (t === "all") return "All notes";
  return t;
}

/** `#tagname body text` → new note with notebook slug `tagname` (lowercase). */
function parseHashNewNote(q) {
  const m = q.trim().match(/^#([a-zA-Z0-9_-]+)\s+(.+)$/);
  if (!m) return null;
  const body = m[2].trim();
  if (!body) return null;
  return { tagSlug: m[1].toLowerCase(), body };
}

const SIDEBAR_TAIL_TAGS = ["images", "files"];

/** Slash commands shown when the search box starts with `/` (UI only until wired to AI). */
const AI_SLASH_COMMANDS = [
  {
    id: "ask",
    label: "Ask AI",
    hint: "Ask a question about your notes",
    keywords: "ask chat question",
  },
  {
    id: "generate",
    label: "Generate",
    hint: "Draft new text from a short prompt",
    keywords: "generate write create draft",
  },
  {
    id: "summarize",
    label: "Summarize",
    hint: "Turn a note into a brief summary",
    keywords: "summarize summary tldr",
  },
  {
    id: "edit",
    label: "Edit",
    hint: "Improve tone, length, or clarity",
    keywords: "edit rewrite improve polish",
  },
  {
    id: "fix",
    label: "Fix grammar",
    hint: "Fix spelling and grammar",
    keywords: "fix grammar spelling typos proofread",
  },
  {
    id: "explain",
    label: "Explain",
    hint: "Explain simply, step by step",
    keywords: "explain clarify teach",
  },
];

const SparklesIcon = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </svg>
);

const AtSignIcon = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </svg>
);

const HashIcon = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </svg>
);

const RestoreIcon = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
  </svg>
);

/** Stub AI transforms; replace with API calls later. Pushes prior version to `contentHistory` before apply. */
function stubAIResult(note, cmdId) {
  const t = note.title;
  const c = note.content;
  switch (cmdId) {
    case "fix": {
      const fixed = c.replace(/\s+/g, " ").trim();
      const cap = fixed.length
        ? fixed.charAt(0).toUpperCase() + fixed.slice(1)
        : fixed;
      return { title: t, content: cap };
    }
    case "edit":
      return {
        title: t,
        content: `${c}\n\n— Refined for clarity (AI preview).`,
      };
    case "summarize": {
      const words = c.trim().split(/\s+/).filter(Boolean);
      const head = words.slice(0, 28).join(" ");
      return {
        title: t,
        content: `Summary:\n${head}${words.length > 28 ? "…" : ""}`,
      };
    }
    case "explain":
      return {
        title: t,
        content: `Simpler take:\n\n${c}\n\n(Connect a model to replace this preview.)`,
      };
    case "ask":
      return {
        title: t,
        content: `${c}\n\n---\nFollow-up space (add your chat model here).`,
      };
    case "generate":
      return {
        title: t,
        content: `${c}\n\n— Generated block (placeholder). Wire your model to replace this.`,
      };
    default:
      return null;
  }
}

const NOTES_STORAGE_KEY = "note-app-notes-v1";

const APP_SECTION_STORAGE_KEY = "note-app-section-v1";
const APP_SECTION_IDS = ["notes", "sites", "bookmarks"];
const APP_SECTION_LABELS = {
  notes: "Notes",
  sites: "Sites",
  bookmarks: "Bookmarks",
};

function isValidAppSection(v) {
  return typeof v === "string" && APP_SECTION_IDS.includes(v);
}

function parseStoredNotes(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data.map((n) => ({
      ...n,
      id: typeof n.id === "number" ? n.id : Number(n.id) || Date.now(),
      tag: typeof n.tag === "string" ? n.tag : "",
      title: typeof n.title === "string" ? n.title : "",
      content: typeof n.content === "string" ? n.content : "",
      createdAt: n.createdAt ? new Date(n.createdAt) : new Date(),
      pinned: Boolean(n.pinned),
      attachments: Array.isArray(n.attachments) ? n.attachments : [],
      contentHistory: Array.isArray(n.contentHistory)
        ? n.contentHistory.map((h) => ({
            title: typeof h?.title === "string" ? h.title : "",
            content: typeof h?.content === "string" ? h.content : "",
            savedAt:
              typeof h?.savedAt === "number"
                ? h.savedAt
                : Number(h?.savedAt) || Date.now(),
          }))
        : [],
    }));
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════ */
export default function NotesApp() {
  const convexDeploymentUrl = useConvexDeploymentUrl();
  const useConvexDb = Boolean(convexDeploymentUrl);

  const convexList = useQuery(api.notes.list, useConvexDb ? {} : "skip");
  const createNoteConvex = useMutation(api.notes.create);
  const updateNoteConvex = useMutation(api.notes.update);
  const removeNoteConvex = useMutation(api.notes.remove);
  const generateUploadUrl = useMutation(api.notes.generateUploadUrl);

  const [localNotes, setLocalNotes] = useState([]);
  const [notesReady, setNotesReady] = useState(false);

  const notes = useMemo(() => {
    if (useConvexDb) {
      if (convexList === undefined) return [];
      return convexList.map(mapConvexNoteToClient);
    }
    return localNotes;
  }, [useConvexDb, convexList, localNotes]);
  const [activeTag, setActiveTag] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [hashActiveIndex, setHashActiveIndex] = useState(0);
  const [aiTargetNoteId, setAiTargetNoteId] = useState(null);
  const [aiFeedback, setAiFeedback] = useState("");
  const [recState, setRecState] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [pulse, setPulse] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [saveTag, setSaveTag] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [voiceNoteModelId, setVoiceNoteModelId] = useState(
    DEFAULT_VOICE_NOTE_MODEL
  );
  const [appSection, setAppSection] = useState("notes");
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const sectionMenuRef = useRef(null);
  const sectionHydrated = useRef(false);

  const isNotesSection = appSection === "notes";

  const recRef = useRef(null);
  const pulseRef = useRef(null);
  const searchRef = useRef(null);
  const themeHydrated = useRef(false);
  const voiceModelHydrated = useRef(false);
  const transcriptRef = useRef("");
  transcriptRef.current = transcript;

  const sidebarTags = useMemo(() => {
    const fromNotes = [
      ...new Set(
        notes
          .map((n) =>
            typeof n.tag === "string" ? n.tag.trim().toLowerCase() : ""
          )
          .filter(Boolean)
          .filter((t) => !RESERVED_NOTEBOOK_SLUGS.has(t))
      ),
    ];
    fromNotes.sort((a, b) => a.localeCompare(b));
    return ["all", ...fromNotes, ...SIDEBAR_TAIL_TAGS];
  }, [notes]);

  useEffect(() => {
    if (useConvexDb) {
      setNotesReady(true);
      return;
    }
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      const parsed = raw ? parseStoredNotes(raw) : null;
      if (parsed && parsed.length) setLocalNotes(parsed);
    } catch {
      /* noop */
    }
    setNotesReady(true);
  }, [useConvexDb]);

  useEffect(() => {
    if (!notesReady || useConvexDb) return;
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(localNotes));
    } catch {
      /* noop */
    }
  }, [localNotes, notesReady, useConvexDb]);

  useEffect(() => {
    if (recState === "recording") {
      pulseRef.current = setInterval(() => setPulse(Math.random() * 100), 80);
    } else {
      clearInterval(pulseRef.current);
      setPulse(0);
    }
    return () => clearInterval(pulseRef.current);
  }, [recState]);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        if (appSection !== "notes") return;
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [appSection]);

  useLayoutEffect(() => {
    if (!themeHydrated.current) {
      themeHydrated.current = true;
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored && THEME_OPTIONS.some((o) => o.id === stored)) {
          setThemeId(stored);
          return;
        }
      } catch {
        /* noop */
      }
    }
    applyThemeToDocument(themeId);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
    } catch {
      /* noop */
    }
  }, [themeId]);

  useLayoutEffect(() => {
    if (!voiceModelHydrated.current) {
      voiceModelHydrated.current = true;
      try {
        const s = localStorage.getItem(VOICE_NOTE_MODEL_KEY);
        if (s?.trim()) {
          setVoiceNoteModelId(s.trim());
          return;
        }
      } catch {
        /* noop */
      }
    }
    try {
      localStorage.setItem(VOICE_NOTE_MODEL_KEY, voiceNoteModelId);
    } catch {
      /* noop */
    }
  }, [voiceNoteModelId]);

  useLayoutEffect(() => {
    if (sectionHydrated.current) return;
    sectionHydrated.current = true;
    try {
      const stored = localStorage.getItem(APP_SECTION_STORAGE_KEY);
      if (isValidAppSection(stored)) setAppSection(stored);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(APP_SECTION_STORAGE_KEY, appSection);
    } catch {
      /* noop */
    }
  }, [appSection]);

  useEffect(() => {
    if (!sectionMenuOpen) return;
    const onDoc = (e) => {
      if (sectionMenuRef.current?.contains(e.target)) return;
      setSectionMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setSectionMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [sectionMenuOpen]);

  const enterFullscreen = useCallback(async () => {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch {
      /* denied or unsupported */
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    const onDocDown = (e) => {
      if (showModal || settingsOpen) return;
      const el = e.target;
      if (el.closest?.(".note-card")) return;
      if (el.closest?.(".dock-search")) return;
      if (el.closest?.(".dock-fab")) return;
      if (el.closest?.(".app-section-dropdown")) return;
      if (el.closest?.(".rec-dock")) return;
      setExpandedId(null);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [showModal, settingsOpen]);

  const hashNoteFromSearch = parseHashNewNote(searchQ);

  const atPaletteOpen = searchFocus && searchQ.startsWith("@");
  const slashPaletteOpen = searchFocus && searchQ.startsWith("/");
  const hashPaletteOpen =
    searchFocus && searchQ.startsWith("#") && !hashNoteFromSearch;
  const commandPaletteOpen =
    atPaletteOpen || slashPaletteOpen || hashPaletteOpen;

  const searchTextForFilter = hashNoteFromSearch
    ? hashNoteFromSearch.body.trim()
    : searchQ.trim();
  const searchHighlightQ = hashNoteFromSearch
    ? hashNoteFromSearch.body
    : searchQ;

  const slashFilterRaw = slashPaletteOpen ? searchQ.slice(1).trim().toLowerCase() : "";
  const slashCommands = slashPaletteOpen
    ? AI_SLASH_COMMANDS.filter((cmd) => {
        if (!slashFilterRaw) return true;
        const hay = `${cmd.label} ${cmd.hint} ${cmd.keywords}`.toLowerCase();
        return slashFilterRaw.split(/\s+/).every((w) => w && hay.includes(w));
      })
    : [];

  const hashFilterRaw = hashPaletteOpen ? searchQ.slice(1).trim().toLowerCase() : "";
  const hashTagMatches = hashPaletteOpen
    ? sidebarTags.filter((t) => {
        if (!hashFilterRaw) return true;
        const hay = `${t} ${sidebarTagMenuLabel(t)}`.toLowerCase();
        return hashFilterRaw
          .split(/\s+/)
          .filter(Boolean)
          .every((w) => hay.includes(w));
      })
    : [];

  const atFilterRaw = atPaletteOpen ? searchQ.slice(1).trim().toLowerCase() : "";
  const atNoteMatches = atPaletteOpen
    ? [...notes]
        .filter((n) => {
          if (!atFilterRaw) return true;
          return n.title.toLowerCase().includes(atFilterRaw);
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    : [];

  useEffect(() => {
    if (!slashPaletteOpen) return;
    setSlashActiveIndex((i) =>
      slashCommands.length ? Math.min(i, slashCommands.length - 1) : 0
    );
  }, [slashPaletteOpen, slashCommands.length, slashFilterRaw]);

  useEffect(() => {
    if (!atPaletteOpen) return;
    setAtActiveIndex((i) =>
      atNoteMatches.length ? Math.min(i, atNoteMatches.length - 1) : 0
    );
  }, [atPaletteOpen, atNoteMatches.length, atFilterRaw]);

  useEffect(() => {
    if (!hashPaletteOpen) return;
    setHashActiveIndex((i) =>
      hashTagMatches.length ? Math.min(i, hashTagMatches.length - 1) : 0
    );
  }, [hashPaletteOpen, hashTagMatches.length, hashFilterRaw]);

  const pickHashTag = useCallback((tag) => {
    setActiveTag(tag);
    setSearchQ("");
    setHashActiveIndex(0);
    searchRef.current?.blur();
  }, []);

  const createNoteFromHashSyntax = useCallback(
    (raw) => {
      const parsed = parseHashNewNote(raw);
      if (!parsed) return false;
      const { title: t, content: c } = titleAndBodyFromPlainText(parsed.body);
      const title = t || parsed.tagSlug;
      if (useConvexDb) {
        void (async () => {
          const nid = await createNoteConvex({
            tag: parsed.tagSlug,
            title,
            content: c,
            createdAt: Date.now(),
            pinned: false,
          });
          setExpandedId(nid);
          setActiveTag(parsed.tagSlug);
          setSearchQ("");
        })();
        return true;
      }
      const n = {
        id: Date.now(),
        tag: parsed.tagSlug,
        title,
        content: c,
        createdAt: new Date(),
        pinned: false,
        attachments: [],
        contentHistory: [],
      };
      setLocalNotes((p) => [n, ...p]);
      setExpandedId(n.id);
      setActiveTag(parsed.tagSlug);
      setSearchQ("");
      return true;
    },
    [useConvexDb, createNoteConvex]
  );

  const pickAtNote = useCallback((note) => {
    setAiTargetNoteId(note.id);
    setSearchQ("");
    setAtActiveIndex(0);
    setAiFeedback("");
    setExpandedId(note.id);
    searchRef.current?.blur();
  }, []);

  const restoreNoteVersion = useCallback(
    (noteId) => {
      const n = notes.find((x) => x.id === noteId);
      if (!n || !(n.contentHistory?.length)) return;
      const prev = n.contentHistory[n.contentHistory.length - 1];
      const rest = n.contentHistory.slice(0, -1);
      const restoredTag = tagFromHashtagInNoteText(prev.title, prev.content);
      const tagPatch =
        restoredTag !== (n.tag || "").toLowerCase()
          ? { tag: restoredTag }
          : {};
      if (useConvexDb) {
        void updateNoteConvex({
          id: n.id,
          title: prev.title,
          content: prev.content,
          contentHistory: rest,
          ...tagPatch,
        });
        return;
      }
      setLocalNotes((p) =>
        p.map((row) =>
          row.id !== noteId
            ? row
            : {
                ...row,
                title: prev.title,
                content: prev.content,
                contentHistory: rest,
                ...tagPatch,
              }
        )
      );
    },
    [notes, useConvexDb, updateNoteConvex]
  );

  const pickSlashCommand = useCallback(
    (cmd) => {
      setAiFeedback("");
      const targetId = aiTargetNoteId;

      if (cmd.id === "generate" && targetId == null) {
        const body =
          "This note was created from **Generate** without an @ note target.\n\nUse @ to pick a note, then / → Generate to append to it.";
        const { title, content } = titleAndBodyFromPlainText(body);
        const tag =
          tagFromHashtagInNoteText(title, content) ||
          notebookTagFromActive(activeTag);
        if (useConvexDb) {
          void (async () => {
            const nid = await createNoteConvex({
              tag,
              title,
              content,
              createdAt: Date.now(),
              pinned: false,
            });
            setExpandedId(nid);
            setActiveTag("all");
            setSearchQ("");
            setSlashActiveIndex(0);
            searchRef.current?.blur();
          })();
          return;
        }
        const n = {
          id: Date.now(),
          tag,
          title,
          content,
          createdAt: new Date(),
          pinned: false,
          attachments: [],
          contentHistory: [],
        };
        setLocalNotes((p) => [n, ...p]);
        setExpandedId(n.id);
        setActiveTag("all");
        setSearchQ("");
        setSlashActiveIndex(0);
        searchRef.current?.blur();
        return;
      }

      if (cmd.id !== "generate" && targetId == null) {
        setAiFeedback("Pick a note with @ first, then run an AI command.");
        setTimeout(() => setAiFeedback(""), 5000);
        return;
      }

      const note = notes.find((x) => x.id === targetId);
      if (!note) return;
      const next = stubAIResult(note, cmd.id);
      if (!next) return;
      const snap = {
        title: note.title,
        content: note.content,
        savedAt: Date.now(),
      };
      const aiTag = tagFromHashtagInNoteText(next.title, next.content);
      const tagPatch =
        aiTag !== (note.tag || "").toLowerCase() ? { tag: aiTag } : {};
      if (useConvexDb) {
        void updateNoteConvex({
          id: note.id,
          title: next.title,
          content: next.content,
          contentHistory: [...(note.contentHistory ?? []), snap],
          ...tagPatch,
        });
      } else {
        setLocalNotes((p) =>
          p.map((row) =>
            row.id !== targetId
              ? row
              : {
                  ...row,
                  title: next.title,
                  content: next.content,
                  contentHistory: [...(row.contentHistory ?? []), snap],
                  ...tagPatch,
                }
          )
        );
      }
      setExpandedId(targetId);
      setSearchQ("");
      setSlashActiveIndex(0);
      searchRef.current?.blur();
    },
    [
      aiTargetNoteId,
      activeTag,
      notes,
      useConvexDb,
      createNoteConvex,
      updateNoteConvex,
    ]
  );

  const filtered = notes.filter((n) => {
    const tagOk = noteMatchesSidebarTag(n, activeTag);
    if (commandPaletteOpen) return false;
    if (!searchTextForFilter) return tagOk;
    const q = searchTextForFilter.toLowerCase();
    const attMatch = (n.attachments ?? []).some((a) =>
      (a.name || "").toLowerCase().includes(q)
    );
    return (
      tagOk &&
      (n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        attMatch)
    );
  });

  const visible = [...filtered].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const stopRec = useCallback(() => {
    recRef.current?.stop();
    setRecState("processing");
    setTimeout(() => {
      setRecState("idle");
      if (transcriptRef.current.trim()) setShowModal(true);
    }, 400);
  }, []);

  const startRec = useCallback(() => {
    setTranscript("");
    setRecState("recording");
    if (
      !("SpeechRecognition" in window) &&
      !("webkitSpeechRecognition" in window)
    ) {
      const demos = [
        "Remember to follow up with the design team about the layout revisions.",
        "Idea — what if onboarding started with a voice prompt instead of a long form?",
        "Journal entry: today felt like a quiet turning point. Something shifted.",
        "Task: review the quarterly numbers before the three o'clock standup.",
      ];
      const txt = demos[Math.floor(Math.random() * demos.length)];
      let i = 0;
      const t = setInterval(() => {
        i++;
        setTranscript(txt.slice(0, i));
        if (i >= txt.length) clearInterval(t);
      }, 36);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recRef.current = new SR();
    recRef.current.continuous = true;
    recRef.current.interimResults = true;
    recRef.current.onresult = (e) =>
      setTranscript(
        Array.from(e.results)
          .map((r) => r[0].transcript)
          .join(" ")
      );
    recRef.current.onerror = () => stopRec();
    recRef.current.start();
  }, [stopRec]);

  const saveNote = () => {
    if (!transcript.trim()) return;
    const { title, content } = titleAndBodyFromPlainText(transcript);
    const tag =
      tagFromHashtagInNoteText(title, content) || saveTag || "";
    if (useConvexDb) {
      void (async () => {
        const nid = await createNoteConvex({
          tag,
          title,
          content,
          createdAt: Date.now(),
          pinned: false,
        });
        setExpandedId(nid);
        setActiveTag("all");
        setTranscript("");
        setShowModal(false);
      })();
      return;
    }
    const n = {
      id: Date.now(),
      tag,
      title,
      content,
      createdAt: new Date(),
      pinned: false,
      attachments: [],
      contentHistory: [],
    };
    setLocalNotes((p) => [n, ...p]);
    setExpandedId(n.id);
    setActiveTag("all");
    setTranscript("");
    setShowModal(false);
  };

  const updateNote = useCallback(
    (id, field, val) => {
      const n = notes.find((x) => x.id === id);
      if (!n) return;
      if (field !== "title" && field !== "content") {
        if (useConvexDb) void updateNoteConvex({ id, [field]: val });
        else
          setLocalNotes((p) =>
            p.map((row) => (row.id === id ? { ...row, [field]: val } : row))
          );
        return;
      }
      const nextTitle = field === "title" ? val : n.title;
      const nextContent = field === "content" ? val : n.content;
      const derivedTag = tagFromHashtagInNoteText(nextTitle, nextContent);
      const tagPatch =
        derivedTag !== (n.tag || "").toLowerCase() ? { tag: derivedTag } : {};
      if (useConvexDb) {
        void updateNoteConvex({ id, [field]: val, ...tagPatch });
        return;
      }
      setLocalNotes((p) =>
        p.map((row) =>
          row.id === id ? { ...row, [field]: val, ...tagPatch } : row
        )
      );
    },
    [useConvexDb, updateNoteConvex, notes]
  );

  const addAttachmentsToNote = useCallback(
    (noteId, fileList) => {
      const files = Array.from(fileList || []).filter(Boolean);
      if (!files.length) return;
      if (useConvexDb) {
        void (async () => {
          const n = notes.find((x) => x.id === noteId);
          if (!n) return;
          const base = attachmentsForConvex(n.attachments);
          const added = [];
          for (const f of files) {
            if (f.size > MAX_ATTACHMENT_BYTES) continue;
            try {
              const storageId = await uploadFileToConvexStorage(
                f,
                generateUploadUrl
              );
              added.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                kind: f.type.startsWith("image/") ? "image" : "file",
                name: f.name || "Attachment",
                mime: f.type || "",
                storageId,
              });
            } catch {
              /* skip failed upload */
            }
          }
          if (!added.length) return;
          await updateNoteConvex({
            id: n.id,
            attachments: [...base, ...added],
          });
        })();
        return;
      }
      Promise.all(files.map((f) => fileToAttachment(f).catch(() => null))).then(
        (results) => {
          const added = results.filter(Boolean);
          if (!added.length) return;
          setLocalNotes((p) =>
            p.map((row) =>
              row.id === noteId
                ? { ...row, attachments: [...(row.attachments ?? []), ...added] }
                : row
            )
          );
        }
      );
    },
    [useConvexDb, notes, generateUploadUrl, updateNoteConvex]
  );

  const createNoteWithDroppedFiles = useCallback(
    (files) => {
      const arr = Array.from(files || []).filter(Boolean);
      if (!arr.length) return;
      const first = arr[0];
      const stem = (
        (first.name || "").replace(/\.[^.]+$/u, "").trim() || "Attachment"
      );
      const title =
        arr.length === 1 ? stem : `${stem} +${arr.length - 1} files`;
      const tag =
        tagFromHashtagInNoteText(title, "") ||
        notebookTagFromActive(activeTag);
      if (useConvexDb) {
        void (async () => {
          const uploads = [];
          for (const f of arr) {
            if (f.size > MAX_ATTACHMENT_BYTES) continue;
            try {
              const storageId = await uploadFileToConvexStorage(
                f,
                generateUploadUrl
              );
              uploads.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                kind: f.type.startsWith("image/") ? "image" : "file",
                name: f.name || "Attachment",
                mime: f.type || "",
                storageId,
              });
            } catch {
              /* skip */
            }
          }
          const nid = await createNoteConvex({
            tag,
            title,
            content: "",
            createdAt: Date.now(),
            pinned: false,
            attachments: uploads,
          });
          setExpandedId(nid);
          setActiveTag("all");
          setSearchQ("");
        })();
        return;
      }
      const id = Date.now();
      const n = {
        id,
        tag,
        title,
        content: "",
        createdAt: new Date(),
        pinned: false,
        attachments: [],
        contentHistory: [],
      };
      setLocalNotes((p) => [n, ...p]);
      setExpandedId(id);
      setActiveTag("all");
      setSearchQ("");
      addAttachmentsToNote(id, arr);
    },
    [
      activeTag,
      addAttachmentsToNote,
      useConvexDb,
      createNoteConvex,
      generateUploadUrl,
    ]
  );

  const handleAppFileDragOver = useCallback(
    (e) => {
      if (appSection !== "notes") return;
      const types = e.dataTransfer?.types;
      const typeList = types ? Array.from(types) : [];
      if (typeList.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    [appSection]
  );

  const handleAppFileDrop = useCallback(
    (e) => {
      if (appSection !== "notes") return;
      const types = e.dataTransfer?.types;
      const typeList = types ? Array.from(types) : [];
      if (!typeList.includes("Files")) return;
      e.preventDefault();
      if (e.target.closest?.(".note-drop-zone")) return;
      if (e.target.closest?.(".modal-overlay")) return;
      const files = mergeFilesFromDataTransfer(e.dataTransfer);
      if (!files.length) return;
      createNoteWithDroppedFiles(files);
    },
    [createNoteWithDroppedFiles, appSection]
  );

  const removeAttachment = useCallback(
    (noteId, attachmentId) => {
      if (useConvexDb) {
        const n = notes.find((x) => x.id === noteId);
        if (!n) return;
        const next = attachmentsForConvex(n.attachments).filter(
          (a) => a.id !== attachmentId
        );
        void updateNoteConvex({ id: n.id, attachments: next });
        return;
      }
      setLocalNotes((p) =>
        p.map((row) =>
          row.id === noteId
            ? {
                ...row,
                attachments: (row.attachments ?? []).filter(
                  (a) => a.id !== attachmentId
                ),
              }
            : row
        )
      );
    },
    [useConvexDb, notes, updateNoteConvex]
  );

  const deleteNote = (id) => {
    if (useConvexDb) void removeNoteConvex({ id });
    else setLocalNotes((p) => p.filter((n) => n.id !== id));
    if (expandedId === id) setExpandedId(null);
    setAiTargetNoteId((cur) => (cur === id ? null : cur));
  };

  useEffect(() => {
    if (aiTargetNoteId == null) return;
    if (!notes.some((n) => n.id === aiTargetNoteId)) setAiTargetNoteId(null);
  }, [notes, aiTargetNoteId]);
  const toggle = (id) => setExpandedId((p) => (p === id ? null : id));

  const togglePin = (id) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    if (useConvexDb) void updateNoteConvex({ id: n.id, pinned: !n.pinned });
    else
      setLocalNotes((p) =>
        p.map((row) => (row.id === id ? { ...row, pinned: !row.pinned } : row))
      );
  };

  const renderTagButtons = (onPick) =>
    sidebarTags.map((t) => {
      const count =
        t === "all"
          ? notes.length
          : t === "images"
            ? notes.filter((n) =>
                (n.attachments ?? []).some((a) => a.kind === "image")
              ).length
            : t === "files"
              ? notes.filter((n) =>
                  (n.attachments ?? []).some((a) => a.kind === "file")
                ).length
              : notes.filter(
                  (n) => (n.tag || "").toLowerCase() === t
                ).length;
      const active = activeTag === t;
      return (
        <button
          key={t}
          type="button"
          className="pill sidebar-pill"
          style={{
            ...s.sidebarPill,
            background: active
              ? "var(--note-sidebar-pill-active-bg)"
              : "transparent",
            color: active
              ? "var(--note-sidebar-pill-active-fg)"
              : "var(--note-sidebar-pill-fg)",
            borderWidth: 0,
            fontWeight: active ? 600 : 500,
          }}
          onClick={() => {
            setActiveTag(t);
            onPick?.();
          }}
        >
          <span
            style={{
              ...s.sidebarPillIcon,
              color: active
                ? "var(--note-sidebar-pill-icon-active)"
                : "var(--note-sidebar-pill-icon)",
            }}
          >
            <TagNavIcon tag={t} />
          </span>
          <span style={s.sidebarPillLabel}>
            {t === "all" ? "All notes" : t}
            {count > 0 && (
              <span style={s.sidebarPillCount}>{count}</span>
            )}
          </span>
        </button>
      );
    });

  const createNoteFromText = useCallback(
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const { title, content } = titleAndBodyFromPlainText(trimmed);
      const tag =
        tagFromHashtagInNoteText(title, content) ||
        notebookTagFromActive(activeTag);
      if (useConvexDb) {
        void (async () => {
          try {
            const nid = await createNoteConvex({
              tag,
              title,
              content,
              createdAt: Date.now(),
              pinned: false,
            });
            setExpandedId(nid);
            setActiveTag("all");
            setSearchQ("");
          } catch (err) {
            console.error("Convex create note failed:", err);
          }
        })();
        return;
      }
      const n = {
        id: Date.now(),
        tag,
        title,
        content,
        createdAt: new Date(),
        pinned: false,
        attachments: [],
        contentHistory: [],
      };
      setLocalNotes((p) => [n, ...p]);
      setExpandedId(n.id);
      setActiveTag("all");
      setSearchQ("");
    },
    [activeTag, useConvexDb, createNoteConvex]
  );

  return (
    <div
      style={s.page}
      className="app-file-drop-root"
      onDragOver={handleAppFileDragOver}
      onDrop={handleAppFileDrop}
    >
      <style>{css}</style>

      {menuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          style={s.sidebarBackdrop}
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div style={s.layout}>
        <aside className="sidebar-desktop" style={s.sidebar}>
          <div style={s.sidebarChrome}>
            <TrafficLights
              onGreen={enterFullscreen}
              onYellow={exitFullscreen}
              onRed={exitFullscreen}
            />
            <button
              type="button"
              style={s.sidebarGear}
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsGlyph />
            </button>
          </div>
          <p style={s.sidebarTitle}>
            {isNotesSection ? "Notebooks" : APP_SECTION_LABELS[appSection]}
          </p>
          {isNotesSection ? (
            <nav style={s.sidebarNavScroll}>{renderTagButtons()}</nav>
          ) : (
            <div style={s.sidebarSectionHint}>
              <p style={s.sidebarSectionHintText}>
                Choose <strong>Notes</strong> in the header to open notebooks
                and search.
              </p>
            </div>
          )}
          <OpenRouterCredits />
        </aside>

        {menuOpen && (
          <aside className="sidebar-drawer" style={s.sidebarDrawer}>
            <div style={s.drawerHeader}>
              <h2 style={s.drawerTitle}>
                {isNotesSection ? "Notebooks" : APP_SECTION_LABELS[appSection]}
              </h2>
              <div style={s.drawerHeaderActions}>
                <button
                  type="button"
                  style={s.sidebarGear}
                  aria-label="Settings"
                  onClick={() => {
                    setMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <SettingsGlyph />
                </button>
                <button
                  type="button"
                  style={s.drawerClose}
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                >
                  <CloseIcon size={14} />
                </button>
              </div>
            </div>
            {isNotesSection ? (
              <nav style={s.sidebarNavScroll}>
                {renderTagButtons(() => setMenuOpen(false))}
              </nav>
            ) : (
              <div style={s.sidebarSectionHint}>
                <p style={s.sidebarSectionHintText}>
                  Choose <strong>Notes</strong> in the header to open notebooks
                  and search.
                </p>
              </div>
            )}
            <OpenRouterCredits style={s.sidebarDrawerCredits} />
          </aside>
        )}

        <div style={s.mainColumn}>
          <div style={s.mainInner}>
            <div style={s.contentRail}>
              <header style={s.header}>
                <button
                  type="button"
                  className="mobile-menu-btn"
                  style={s.menuBtn}
                  onClick={() => setMenuOpen(true)}
                  aria-label="Open notebooks menu"
                >
                  <MenuIcon />
                </button>
                <div
                  ref={sectionMenuRef}
                  className="app-section-dropdown"
                  style={s.appSectionWrap}
                >
                  <button
                    type="button"
                    className="app-section-trigger-hit"
                    style={s.appSectionTrigger}
                    aria-expanded={sectionMenuOpen}
                    aria-haspopup="listbox"
                    aria-label={`Switch section (current: ${APP_SECTION_LABELS[appSection]})`}
                    onClick={() => setSectionMenuOpen((o) => !o)}
                  >
                    <span className="app-section-current-label">
                      {APP_SECTION_LABELS[appSection]}
                    </span>
                    <ChevronDownIcon open={sectionMenuOpen} />
                  </button>
                  {sectionMenuOpen ? (
                    <div
                      role="listbox"
                      aria-label="App section"
                      style={s.appSectionMenu}
                    >
                      {APP_SECTION_IDS.map((id) => {
                        const active = appSection === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            className="app-section-menuitem"
                            style={{
                              ...s.appSectionMenuItem,
                              ...(active ? s.appSectionMenuItemActive : {}),
                            }}
                            onClick={() => {
                              setAppSection(id);
                              setSectionMenuOpen(false);
                            }}
                          >
                            {APP_SECTION_LABELS[id]}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </header>

              <main style={s.main}>
                {isNotesSection ? (
                  <>
                    {visible.length === 0 && (
                      <div style={s.empty}>
                        <p style={s.emptyTitle}>
                          {atPaletteOpen
                            ? "Mention a note"
                            : slashPaletteOpen
                              ? "AI commands"
                              : hashPaletteOpen
                                ? "Sidebar tags"
                                : searchQ.trim()
                                  ? `No notes match your search`
                                  : activeTag === "images"
                                    ? "No notes with images"
                                    : activeTag === "files"
                                      ? "No notes with files"
                                      : "No notes yet"}
                        </p>
                        <p style={s.emptySub}>
                          {atPaletteOpen
                            ? "Select a note by title for AI actions, then use / for commands like Fix or Summarize."
                            : slashPaletteOpen
                              ? "Choose an action below, or keep typing to filter. Esc clears the palette."
                              : hashPaletteOpen
                                ? "Pick a tag to match the sidebar filter — same as clicking notebooks on the left."
                                : searchQ.trim()
                                  ? "Press Enter in the search bar to save your text as a new note."
                                  : activeTag === "images"
                                    ? "Add images to a note from the expanded note view, or drop files onto the app."
                                    : activeTag === "files"
                                      ? "Attach non-image files to a note, or drop them onto the app to create a note."
                                      : "Use the search bar to find or add notes, or Voice to dictate. @ picks a note for AI; / opens commands."}
                        </p>
                      </div>
                    )}

                    {visible.map((note) => {
                      const open = expandedId === note.id;
                      return (
                        <NoteCard
                          key={note.id}
                          note={note}
                          open={open}
                          searchQ={searchHighlightQ}
                          onToggle={() => toggle(note.id)}
                          onUpdate={(f, v) => updateNote(note.id, f, v)}
                          onDelete={() => deleteNote(note.id)}
                          onPin={() => togglePin(note.id)}
                          onRestorePrevious={() =>
                            restoreNoteVersion(note.id)
                          }
                          onAddAttachments={(files) =>
                            addAttachmentsToNote(note.id, files)
                          }
                          onRemoveAttachment={(attId) =>
                            removeAttachment(note.id, attId)
                          }
                        />
                      );
                    })}
                  </>
                ) : (
                  <div style={s.empty}>
                    <p style={s.emptyTitle}>
                      {appSection === "sites" ? "Sites" : "Bookmarks"}
                    </p>
                    <p style={s.emptySub}>
                      {appSection === "sites"
                        ? "Saved sites and quick links will live here."
                        : "Saved bookmarks will live here."}{" "}
                      Switch to Notes in the header for notebooks and search.
                    </p>
                  </div>
                )}

                <div style={{ height: 200 }} aria-hidden />
              </main>
            </div>
          </div>
        </div>
      </div>

      {/* ── RECORDING CARD ── */}
      {recState !== "idle" && (
        <div className="rec-dock" style={s.recCard}>
          <div style={s.recRow}>
            <span style={s.recDot} />
            <span style={s.recLbl}>
              {recState === "recording" ? "Listening…" : "Processing…"}
            </span>
          </div>
          <Waveform active={recState === "recording"} pulse={pulse} />
          {transcript && <p style={s.liveTxt}>&quot;{transcript}&quot;</p>}
          {recState === "recording" && (
            <button className="stop-btn" type="button" style={s.stopBtn} onClick={stopRec}>
              <StopIcon size={14} /> Stop
            </button>
          )}
        </div>
      )}

      {/* ── MODAL ── */}
      {showModal && (
        <div
          className="modal-overlay"
          style={s.overlay}
          onClick={() => setShowModal(false)}
        >
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalTop}>
              <span style={s.modalHd}>New voice note</span>
              <button
                style={s.modalX}
                onClick={() => setShowModal(false)}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>
            <textarea
              style={s.modalTa}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              autoFocus
              placeholder="Transcribed text…"
            />
            <div style={s.modalMeta}>
              <span style={s.modalMetaLbl}>Notebook</span>
              <p style={s.voiceModalModelHint}>
                Type <kbd style={s.kbd}>#tagname</kbd> in the text to set the
                notebook (first hashtag wins). Or pick an existing tag below.
              </p>
              <div style={s.inlineTags}>
                <button
                  type="button"
                  className="inline-tag"
                  style={{
                    ...s.inlineTag,
                    background:
                      saveTag === ""
                        ? "var(--note-accent)"
                        : "var(--note-surface)",
                    color:
                      saveTag === ""
                        ? "var(--note-on-accent)"
                        : "var(--note-text-empty)",
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor:
                      saveTag === ""
                        ? "var(--note-accent)"
                        : "var(--note-border)",
                  }}
                  onClick={() => setSaveTag("")}
                >
                  Untagged
                </button>
                {sidebarTags
                  .filter((t) => t !== "all" && !FILTER_ONLY_TAGS.has(t))
                  .map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="inline-tag"
                      style={{
                        ...s.inlineTag,
                        background:
                          saveTag === t
                            ? "var(--note-accent)"
                            : "var(--note-surface)",
                        color:
                          saveTag === t
                            ? "var(--note-on-accent)"
                            : "var(--note-text-empty)",
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor:
                          saveTag === t
                            ? "var(--note-accent)"
                            : "var(--note-border)",
                      }}
                      onClick={() => setSaveTag(t)}
                    >
                      {t}
                    </button>
                  ))}
              </div>
            </div>
            <div style={s.modalMeta}>
              <span style={s.modalMetaLbl}>OpenRouter model</span>
              <span style={s.voiceModalModel} title={voiceNoteModelId}>
                {formatVoiceModelIdForUi(voiceNoteModelId)}
              </span>
              <p style={s.voiceModalModelHint}>
                Change in Settings → Voice note. Used when voice notes call
                OpenRouter.
              </p>
            </div>
            <div style={s.modalActions}>
              <button
                type="button"
                style={s.btnGhost}
                onClick={() => {
                  setShowModal(false);
                  setTranscript("");
                }}
              >
                Discard
              </button>
              <button type="button" style={s.btnDark} onClick={saveNote}>
                Save note
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="modal-overlay"
          style={s.overlay}
          onClick={() => setSettingsOpen(false)}
        >
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalTop}>
              <span style={s.modalHd}>Settings</span>
              <button
                type="button"
                style={s.modalX}
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                <CloseIcon />
              </button>
            </div>
            <p style={s.settingsCopy}>
              Shortcuts and display options for Notes. On iPhone or iPad, use
              Share → Add to Home Screen for a full-screen app; open once online
              so the offline copy can cache.
            </p>
            <p style={themeUi.sectionLabel}>Theme</p>
            <div style={themeUi.grid} role="listbox" aria-label="Color theme">
              {THEME_OPTIONS.map((opt) => {
                const selected = themeId === opt.id;
                const p = getThemePreview(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setThemeId(opt.id)}
                    style={{
                      ...themeUi.card,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected
                        ? "var(--note-accent)"
                        : "var(--note-border)",
                      padding: selected ? 9 : 10,
                    }}
                  >
                    <div style={themeUi.cardPreviewRow}>
                      <div
                        style={{
                          ...themeUi.cardSwatch,
                          background: p.sidebar,
                        }}
                      />
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            ...themeUi.cardLabel,
                            color: p.heading,
                          }}
                        >
                          {opt.label}
                        </span>
                        <div
                          style={{
                            ...themeUi.cardAccentBar,
                            background: p.accent,
                          }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <p style={themeUi.sectionLabel}>Voice note</p>
            <p style={s.settingsCopy}>
              Model for voice-note AI (OpenRouter).
            </p>
            <label htmlFor="voice-model-select" style={s.settingsFieldLbl}>
              Model
            </label>
            <select
              id="voice-model-select"
              style={s.settingsSelect}
              value={voiceNoteModelId}
              onChange={(e) => setVoiceNoteModelId(e.target.value)}
            >
              {[
                ...VOICE_NOTE_MODEL_PRESETS,
                ...(VOICE_NOTE_MODEL_PRESETS.some(
                  (p) => p.id === voiceNoteModelId
                )
                  ? []
                  : [
                      {
                        id: voiceNoteModelId,
                        label: `${formatVoiceModelIdForUi(voiceNoteModelId)} (saved)`,
                      },
                    ]),
              ].map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <ul style={s.settingsList}>
              <li>
                <kbd style={s.kbd}>⌘K</kbd> Focus search
              </li>
              <li>
                <kbd style={s.kbd}>/</kbd> in search opens AI command list
              </li>
              <li>
                <kbd style={s.kbd}>@</kbd> in search picks a note for AI (then use /)
              </li>
              <li>
                <kbd style={s.kbd}>#</kbd> in search filters notebooks;{" "}
                <kbd style={s.kbd}>#slug My text…</kbd> creates a note in that
                notebook. Inside a note, <kbd style={s.kbd}>#slug</kbd> sets the
                notebook (first hashtag in title or body).
              </li>
              <li>After an AI edit, use Restore in the note to bring back the prior version</li>
              <li>Enter in search saves a new note (when not using @, /, or #)</li>
            </ul>
            <p style={s.settingsHint}>
              Green traffic light enters full screen; yellow or red exits
              (browser full screen).
            </p>
            <div style={s.modalActions}>
              <button
                type="button"
                style={s.btnDark}
                onClick={() => setSettingsOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SEARCH BAR (@ · / · # palettes) — Notes only ── */}
      {isNotesSection ? (
      <div
        className="dock-search"
        style={s.searchDockWrap}
      >
        {atPaletteOpen && (
          <div
            className="at-note-palette"
            style={s.slashPalette}
            role="listbox"
            aria-label="Notes"
          >
            <div style={s.slashPaletteHeader}>
              <span style={s.slashPaletteHeaderIcon}>
                <AtSignIcon size={16} />
              </span>
              <span style={s.slashPaletteHeaderText}>Notes</span>
              <span style={s.slashPaletteHeaderHint}>
                {atNoteMatches.length
                  ? `${atNoteMatches.length} match${atNoteMatches.length === 1 ? "" : "es"}`
                  : "No matches"}
              </span>
            </div>
            <div style={s.slashPaletteList}>
              {atNoteMatches.map((n, idx) => {
                const active = idx === atActiveIndex;
                return (
                  <button
                    key={n.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    style={{
                      ...s.slashRow,
                      ...(active ? s.slashRowActive : {}),
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setAtActiveIndex(idx)}
                    onClick={() => pickAtNote(n)}
                  >
                    <span style={s.slashRowIcon}>
                      <AtSignIcon size={17} />
                    </span>
                    <span style={s.slashRowBody}>
                      <span style={s.slashRowLabel}>{n.title || "Untitled"}</span>
                      <span style={s.slashRowHint}>
                        {(n.content || "").replace(/\s+/g, " ").trim().slice(0, 72)}
                        {(n.content || "").length > 72 ? "…" : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {slashPaletteOpen && (
          <div
            className="slash-command-palette"
            style={s.slashPalette}
            role="listbox"
            aria-label="AI commands"
          >
            <div style={s.slashPaletteHeader}>
              <span style={s.slashPaletteHeaderIcon}>
                <SparklesIcon size={16} />
              </span>
              <span style={s.slashPaletteHeaderText}>AI</span>
              <span style={s.slashPaletteHeaderHint}>
                {slashCommands.length
                  ? `${slashCommands.length} command${slashCommands.length === 1 ? "" : "s"}`
                  : "No matches"}
              </span>
            </div>
            <div style={s.slashPaletteList}>
              {slashCommands.map((cmd, idx) => {
                const active = idx === slashActiveIndex;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    style={{
                      ...s.slashRow,
                      ...(active ? s.slashRowActive : {}),
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setSlashActiveIndex(idx)}
                    onClick={() => pickSlashCommand(cmd)}
                  >
                    <span style={s.slashRowIcon}>
                      <SparklesIcon size={17} />
                    </span>
                    <span style={s.slashRowBody}>
                      <span style={s.slashRowLabel}>{cmd.label}</span>
                      <span style={s.slashRowHint}>{cmd.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {hashPaletteOpen && (
          <div
            className="hash-tag-palette"
            style={s.slashPalette}
            role="listbox"
            aria-label="Sidebar tags"
          >
            <div style={s.slashPaletteHeader}>
              <span style={s.slashPaletteHeaderIcon}>
                <HashIcon size={16} />
              </span>
              <span style={s.slashPaletteHeaderText}>Tags</span>
              <span style={s.slashPaletteHeaderHint}>
                {hashTagMatches.length
                  ? `${hashTagMatches.length} match${hashTagMatches.length === 1 ? "" : "es"}`
                  : "No matches"}
              </span>
            </div>
            <div style={s.slashPaletteList}>
              {hashTagMatches.map((t, idx) => {
                const active = idx === hashActiveIndex;
                const count =
                  t === "all"
                    ? notes.length
                    : t === "images"
                      ? notes.filter((n) =>
                          (n.attachments ?? []).some((a) => a.kind === "image")
                        ).length
                      : t === "files"
                        ? notes.filter((n) =>
                            (n.attachments ?? []).some((a) => a.kind === "file")
                          ).length
                        : notes.filter(
                            (n) => (n.tag || "").toLowerCase() === t
                          ).length;
                return (
                  <button
                    key={t}
                    type="button"
                    role="option"
                    aria-selected={active}
                    style={{
                      ...s.slashRow,
                      ...(active ? s.slashRowActive : {}),
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHashActiveIndex(idx)}
                    onClick={() => pickHashTag(t)}
                  >
                    <span style={s.slashRowIcon}>
                      <TagNavIcon tag={t} />
                    </span>
                    <span style={s.slashRowBody}>
                      <span style={s.slashRowLabel}>
                        {sidebarTagMenuLabel(t)}
                      </span>
                      <span style={s.slashRowHint}>
                        {count > 0
                          ? `${count} note${count === 1 ? "" : "s"}`
                          : "No notes"}
                        {activeTag === t ? " · current filter" : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div
          style={{
            ...s.searchBar,
            borderWidth: 1.5,
            borderStyle: "solid",
            borderColor: searchFocus
              ? "var(--note-text)"
              : "var(--note-border)",
            boxShadow: searchFocus
              ? "var(--note-search-focus-ring)"
              : "var(--note-search-shadow)",
          }}
        >
          <SearchIcon active={searchFocus} />
          {aiTargetNoteId &&
            (() => {
              const tn = notes.find((n) => n.id === aiTargetNoteId);
              if (!tn) return null;
              const label = tn.title?.trim() || "Untitled";
              const short =
                label.length > 24 ? `${label.slice(0, 22)}…` : label;
              return (
                <span style={s.aiTargetChip} title={`AI target: ${label}`}>
                  <span style={s.aiTargetChipIcon}>
                    <AtSignIcon size={14} />
                  </span>
                  <span style={s.aiTargetChipLabel}>{short}</span>
                  <button
                    type="button"
                    style={s.aiTargetChipClear}
                    aria-label="Clear AI note target"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setAiTargetNoteId(null);
                      setAiFeedback("");
                    }}
                  >
                    <CloseIcon size={10} />
                  </button>
                </span>
              );
            })()}
          <input
            ref={searchRef}
            style={s.searchInput}
            dir="auto"
            suppressHydrationWarning
            placeholder="Search…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onFocus={() => {
              setSearchFocus(true);
              setExpandedId(null);
            }}
            onBlur={() => setSearchFocus(false)}
            onKeyDown={(e) => {
              if (atPaletteOpen) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchQ("");
                  setAtActiveIndex(0);
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!atNoteMatches.length) return;
                  setAtActiveIndex((i) =>
                    i + 1 >= atNoteMatches.length ? 0 : i + 1
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!atNoteMatches.length) return;
                  setAtActiveIndex((i) =>
                    i - 1 < 0 ? atNoteMatches.length - 1 : i - 1
                  );
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const picked = atNoteMatches[atActiveIndex];
                  if (picked) pickAtNote(picked);
                  return;
                }
              }
              if (slashPaletteOpen) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchQ("");
                  setSlashActiveIndex(0);
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!slashCommands.length) return;
                  setSlashActiveIndex((i) =>
                    i + 1 >= slashCommands.length ? 0 : i + 1
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!slashCommands.length) return;
                  setSlashActiveIndex((i) =>
                    i - 1 < 0 ? slashCommands.length - 1 : i - 1
                  );
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const cmd = slashCommands[slashActiveIndex];
                  if (cmd) pickSlashCommand(cmd);
                  return;
                }
              }
              if (hashPaletteOpen) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchQ("");
                  setHashActiveIndex(0);
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!hashTagMatches.length) return;
                  setHashActiveIndex((i) =>
                    i + 1 >= hashTagMatches.length ? 0 : i + 1
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!hashTagMatches.length) return;
                  setHashActiveIndex((i) =>
                    i - 1 < 0 ? hashTagMatches.length - 1 : i - 1
                  );
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const picked = hashTagMatches[hashActiveIndex];
                  if (picked != null) pickHashTag(picked);
                  return;
                }
              }
              if (e.key !== "Enter") return;
              if (!searchQ.trim()) return;
              if (searchQ.startsWith("#")) {
                if (createNoteFromHashSyntax(searchQ)) e.preventDefault();
                return;
              }
              if (searchQ.startsWith("/") || searchQ.startsWith("@")) return;
              e.preventDefault();
              createNoteFromText(searchQ);
            }}
          />
          {searchQ.trim() && !commandPaletteOpen && (
            <button
              type="button"
              className="search-add-hover"
              style={s.searchAddBtn}
              onClick={() => {
                if (!createNoteFromHashSyntax(searchQ))
                  createNoteFromText(searchQ);
              }}
            >
              Add note
            </button>
          )}
          {searchQ ? (
            <button
              type="button"
              style={s.clearBtn}
              onClick={() => {
                setSearchQ("");
                setSlashActiveIndex(0);
                setAtActiveIndex(0);
                setHashActiveIndex(0);
                setAiTargetNoteId(null);
                setAiFeedback("");
              }}
            >
              <CloseIcon size={12} />
            </button>
          ) : (
            <kbd style={s.kbd}>⌘K</kbd>
          )}
          {searchQ && !commandPaletteOpen && visible.length > 0 && (
            <span style={s.badge}>{visible.length}</span>
          )}
        </div>
        {aiFeedback ? (
          <p style={s.aiFeedback} role="status">
            {aiFeedback}
          </p>
        ) : null}
      </div>
      ) : null}

      {/* ── FAB — Notes only ── */}
      {isNotesSection ? (
      <button
        type="button"
        className="fab dock-fab"
        style={{ ...s.fab, ...(recState === "recording" ? s.fabRec : {}) }}
        onClick={recState === "recording" ? stopRec : startRec}
        title={recState === "recording" ? "Stop recording" : "Dictate a note"}
      >
        <span style={s.fabInner}>
          {recState === "recording" ? (
            <>
              <StopIcon size={16} />
              <span style={s.fabLabel}>Stop</span>
            </>
          ) : (
            <>
              <MicIcon />
              <span style={s.fabLabel}>Voice</span>
            </>
          )}
        </span>
      </button>
      ) : null}
    </div>
  );
}

/* ─── NoteCard ──────────────────────────────────── */
function NoteCard({
  note,
  open,
  searchQ,
  onToggle,
  onUpdate,
  onDelete,
  onPin,
  onRestorePrevious,
  onAddAttachments,
  onRemoveAttachment,
}) {
  const textareaRef = useRef(null);
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftContent, setDraftContent] = useState(note.content ?? "");
  const latestTitleRef = useRef(note.title);
  const latestContentRef = useRef(note.content ?? "");
  const titleTimerRef = useRef(null);
  const contentTimerRef = useRef(null);

  const flushTitle = useCallback(() => {
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
    }
    onUpdate("title", latestTitleRef.current);
  }, [onUpdate]);

  const flushContent = useCallback(() => {
    if (contentTimerRef.current) {
      clearTimeout(contentTimerRef.current);
      contentTimerRef.current = null;
    }
    onUpdate("content", latestContentRef.current);
  }, [onUpdate]);

  const flushBoth = useCallback(() => {
    flushTitle();
    flushContent();
  }, [flushTitle, flushContent]);

  useLayoutEffect(() => {
    if (!open) {
      if (titleTimerRef.current) {
        clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
      }
      if (contentTimerRef.current) {
        clearTimeout(contentTimerRef.current);
        contentTimerRef.current = null;
      }
      return;
    }
    setDraftTitle(note.title);
    setDraftContent(note.content ?? "");
    latestTitleRef.current = note.title;
    latestContentRef.current = note.content ?? "";
  }, [open, note.id]);

  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    };
  }, []);

  const pinned = !!note.pinned;
  const attachments = note.attachments ?? [];
  const historyDepth = note.contentHistory?.length ?? 0;
  const firstImage = attachments.find((a) => a.kind === "image");

  const contentTrim = note.content.trim();
  const titleTrim = note.title.trim();
  const hideSnippet = !contentTrim || contentTrim === titleTrim;

  const q = searchQ.trim();
  const qLower = q.toLowerCase();
  const bodyMatchExcerpt = q ? excerptAroundMatch(note.content, q) : null;
  const matchedAttachments = q
    ? attachments.filter((a) => (a.name || "").toLowerCase().includes(qLower))
    : [];

  const showBodySearchLine = Boolean(q && bodyMatchExcerpt);
  const showAttachmentSearchLine =
    Boolean(q && matchedAttachments.length && !showBodySearchLine);
  const showClassicSnippet =
    !showBodySearchLine &&
    !showAttachmentSearchLine &&
    !hideSnippet;

  useEffect(() => {
    if (open && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [open, draftContent]);

  const onTitleChange = (e) => {
    const v = e.target.value;
    latestTitleRef.current = v;
    setDraftTitle(v);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      onUpdate("title", latestTitleRef.current);
      titleTimerRef.current = null;
    }, 450);
  };

  const onContentChange = (e) => {
    const v = e.target.value;
    latestContentRef.current = v;
    setDraftContent(v);
    e.target.style.height = "auto";
    e.target.style.height = e.target.scrollHeight + "px";
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    contentTimerRef.current = setTimeout(() => {
      onUpdate("content", latestContentRef.current);
      contentTimerRef.current = null;
    }, 450);
  };

  const cardStyle = {
    ...s.card,
    ...(open ? s.cardOpen : {}),
  };

  return (
    <div className="note-card" style={cardStyle} dir="auto">
      {!open ? (
        <div style={s.cardHead} onClick={onToggle}>
          <div style={s.cardHeadLeft}>
            <div style={s.cardTitleRow}>
              {pinned && (
                <span style={s.listPin} title="Bookmarked to top" aria-hidden>
                  <BookmarkIcon filled />
                </span>
              )}
              <span style={s.cardTitleFlex}>
                <span style={s.cardTitle}>{hl(note.title, searchQ)}</span>
              </span>
            </div>
            {(firstImage?.dataUrl || firstImage?.url) && (
              <img
                src={firstImage.dataUrl || firstImage.url}
                alt=""
                style={s.cardListThumb}
                draggable={false}
              />
            )}
            {showBodySearchLine && (
              <span style={s.cardSearchExcerpt} dir="auto">
                {hl(bodyMatchExcerpt, searchQ)}
              </span>
            )}
            {showAttachmentSearchLine && (
              <span style={s.cardSearchExcerpt} dir="auto">
                <span style={s.cardAttLabel}>Attachment · </span>
                {matchedAttachments.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 ? " · " : null}
                    {hl(a.name, searchQ)}
                  </span>
                ))}
              </span>
            )}
            {showClassicSnippet && (
              <span style={s.cardSnippet} dir="auto">
                {hl(
                  note.content
                    .replace(/\n/g, " ")
                    .replace(/\s+/g, " ")
                    .trim(),
                  searchQ
                )}
              </span>
            )}
          </div>
          <div style={s.cardHeadRight}>
            <span style={s.cardTime} dir="ltr">
              {fmt(note.createdAt)}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div
            style={s.cardToolbar}
            onClick={(e) => {
              if (e.target.closest("input, button, textarea")) return;
              flushBoth();
              onToggle();
            }}
          >
            <div style={s.toolbarMain}>
              <div style={s.toolbarTitleCol}>
                <input
                  style={s.toolbarTitleInput}
                  value={draftTitle}
                  onChange={onTitleChange}
                  onBlur={flushTitle}
                  placeholder="Untitled"
                  aria-label="Note title"
                  dir="auto"
                />
              </div>
              {historyDepth > 0 && (
                <button
                  type="button"
                  className="restore-btn"
                  style={{
                    ...s.toolbarCornerBtn,
                    color: "var(--note-text-secondary)",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    flushBoth();
                    onRestorePrevious?.();
                  }}
                  title={
                    historyDepth > 1
                      ? `Restore previous version (${historyDepth} saved)`
                      : "Restore version from before the last AI edit"
                  }
                  aria-label="Restore previous version before AI edit"
                >
                  <RestoreIcon size={17} />
                </button>
              )}
              <button
                type="button"
                className="del-btn"
                style={s.toolbarCornerBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  flushBoth();
                  onDelete();
                }}
                aria-label="Delete note"
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                className="pin-btn"
                style={{
                  ...s.toolbarCornerBtn,
                  color: pinned
                    ? "var(--note-pin-active)"
                    : "var(--note-text-tertiary)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  flushBoth();
                  onPin();
                }}
                aria-label={
                  pinned ? "Remove bookmark from top" : "Bookmark note to top"
                }
                aria-pressed={pinned}
              >
                <BookmarkIcon filled={pinned} />
              </button>
            </div>
          </div>
          <div
            style={s.cardBody}
            className="note-drop-zone"
            onMouseDown={(e) => e.stopPropagation()}
            onDragEnter={(e) => {
              e.preventDefault();
              const rel = e.relatedTarget;
              if (!rel || !e.currentTarget.contains(rel)) {
                e.currentTarget.classList.add("note-drop-zone--active");
              }
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              const rel = e.relatedTarget;
              if (!rel || !e.currentTarget.contains(rel)) {
                e.currentTarget.classList.remove("note-drop-zone--active");
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.remove("note-drop-zone--active");
              const files = mergeFilesFromDataTransfer(e.dataTransfer);
              if (files.length) onAddAttachments?.(files);
            }}
          >
            <textarea
              ref={textareaRef}
              style={s.editBody}
              value={draftContent}
              onChange={onContentChange}
              onBlur={flushContent}
              placeholder="Write something… Drop images or files here, or paste them."
              dir="auto"
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files || []);
                if (files.length && onAddAttachments) {
                  e.preventDefault();
                  onAddAttachments(files);
                }
              }}
            />
            {attachments.length > 0 && (
              <div style={s.attachmentsBlock}>
                {attachments.map((a) =>
                  a.kind === "image" ? (
                    <div key={a.id} style={s.attachmentImageWrap}>
                      <img
                        src={a.dataUrl || a.url}
                        alt={a.name}
                        style={s.attachmentImage}
                      />
                      <button
                        type="button"
                        style={s.attachmentRemove}
                        aria-label={`Remove ${a.name}`}
                        onClick={() => onRemoveAttachment?.(a.id)}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </div>
                  ) : (
                    <div key={a.id} style={s.attachmentFileRow}>
                      <span style={s.attachmentFileName} dir="auto">
                        {a.name}
                      </span>
                      <button
                        type="button"
                        className="del-btn"
                        style={s.attachmentFileRemove}
                        aria-label={`Remove ${a.name}`}
                        onClick={() => onRemoveAttachment?.(a.id)}
                      >
                        Remove
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
            <span style={s.bodyTime} dir="ltr">
              {fmt(note.createdAt)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Waveform ──────────────────────────────────── */
function Waveform({ active, pulse }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2.5,
        height: 34,
      }}
    >
      {Array.from({ length: 26 }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 3,
            borderRadius: 2,
            background: "var(--note-text)",
            minHeight: 3,
            height: active
              ? `${4 + Math.abs(Math.sin(i * 0.7 + pulse * 0.05)) * pulse * 0.28}px`
              : "3px",
            opacity: active ? 0.6 + Math.sin(i) * 0.4 : 0.15,
            transition: "height 0.08s ease, opacity 0.08s ease",
          }}
        />
      ))}
    </div>
  );
}

/* ─── styles ────────────────────────────────────── */
const s = {
  page: {
    width: "100%",
    minHeight: "100dvh",
    background: "var(--note-page-bg)",
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
    color: "var(--note-page-fg)",
    display: "flex",
    flexDirection: "column",
  },

  layout: {
    display: "flex",
    width: "100%",
    flex: 1,
    minHeight: "100dvh",
    alignItems: "stretch",
  },

  sidebar: {
    width: 272,
    flexShrink: 0,
    background: "var(--note-sidebar-bg)",
    margin: 0,
    padding: "18px 14px 28px",
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignSelf: "stretch",
    minHeight: "100dvh",
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: "var(--note-sidebar-border)",
  },
  sidebarChrome: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "var(--note-sidebar-chrome-border)",
  },
  trafficRow: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  trafficLightBtn: {
    border: "none",
    background: "transparent",
    padding: 4,
    margin: 0,
    cursor: "pointer",
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 0,
  },
  trafficDot: {
    width: 11,
    height: 11,
    borderRadius: "50%",
    flexShrink: 0,
    pointerEvents: "none",
  },
  sidebarGear: {
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    border: "none",
    background: "var(--note-sidebar-gear-bg)",
    cursor: "pointer",
    color: "var(--note-sidebar-gear-fg)",
    padding: 0,
  },
  sidebarTitle: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "var(--note-sidebar-title)",
    margin: "4px 0 10px",
    paddingLeft: 6,
  },
  sidebarNav: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  sidebarNavScroll: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  sidebarDrawerCredits: {
    paddingLeft: 2,
    paddingRight: 2,
    paddingBottom: 8,
  },
  sidebarPill: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    width: "100%",
    textAlign: "left",
    padding: "11px 12px",
    borderRadius: 10,
    fontSize: 15,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
    letterSpacing: "-0.01em",
    fontFamily: "inherit",
  },
  sidebarPillIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sidebarPillLabel: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    textTransform: "capitalize",
  },
  sidebarPillCount: {
    fontSize: 13,
    fontWeight: 500,
    opacity: 0.55,
    fontVariantNumeric: "tabular-nums",
  },
  sidebarDrawer: {
    position: "fixed",
    left: 0,
    top: 0,
    bottom: 0,
    width: "min(calc(100vw - 40px), 420px)",
    maxWidth: "92vw",
    background: "var(--note-sidebar-bg)",
    zIndex: 850,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    boxShadow: "var(--note-drawer-shadow)",
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: "var(--note-sidebar-border)",
  },
  drawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "var(--note-sidebar-chrome-border)",
  },
  drawerTitle: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.03em",
    color: "var(--note-sidebar-pill-active-fg)",
    margin: 0,
    flex: 1,
    minWidth: 0,
  },
  drawerHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  drawerClose: {
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-sidebar-chrome-border)",
    background: "var(--note-sidebar-gear-bg)",
    cursor: "pointer",
    color: "var(--note-sidebar-pill-fg)",
    flexShrink: 0,
    padding: 0,
  },
  sidebarBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 840,
    background: "var(--note-backdrop)",
    border: "none",
    cursor: "pointer",
    padding: 0,
    margin: 0,
  },

  mainColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    background: "var(--note-main-bg)",
  },
  mainInner: {
    width: "100%",
    maxWidth: "none",
    margin: "0 auto",
    paddingLeft: 16,
    paddingRight: 16,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },

  /** Same width as fixed search bar (see `.dock-search` in CSS). */
  contentRail: {
    width: "100%",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },

  header: {
    display: "grid",
    gridTemplateColumns: "44px minmax(0, 1fr)",
    alignItems: "center",
    padding: "16px 16px 12px",
    gap: 8,
  },
  menuBtn: {
    width: 44,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border-subtle)",
    background: "var(--note-surface)",
    cursor: "pointer",
    color: "var(--note-text)",
    padding: 0,
  },
  appSectionWrap: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    minWidth: "min-content",
    overflow: "visible",
  },
  appSectionTrigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    padding: "8px 12px",
    borderRadius: 10,
    borderWidth: 0,
    background: "transparent",
    cursor: "pointer",
    color: "var(--note-text)",
    fontFamily: "inherit",
    width: "max-content",
    maxWidth: "100%",
    flexShrink: 0,
    lineHeight: 1.2,
  },
  appSectionMenu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: "50%",
    transform: "translateX(-50%)",
    minWidth: 212,
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    background: "var(--note-surface)",
    boxShadow: "var(--note-card-shadow-open)",
    zIndex: 850,
  },
  appSectionMenuItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: 8,
    borderWidth: 0,
    background: "transparent",
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 500,
    color: "var(--note-text)",
    fontFamily: "inherit",
  },
  appSectionMenuItemActive: {
    background: "var(--note-sidebar-pill-hover-bg)",
    fontWeight: 600,
  },

  sidebarSectionHint: {
    padding: "12px 14px 20px",
    flex: 1,
    minHeight: 0,
  },
  sidebarSectionHintText: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--note-text-secondary)",
  },

  main: {
    padding: "8px 0 0",
    flex: 1,
  },

  card: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    borderRadius: 14,
    marginBottom: 10,
    background: "var(--note-surface)",
    overflow: "hidden",
    transition: "border-color 0.15s, box-shadow 0.2s",
    animation: "fadeUp 0.2s ease backwards",
    boxShadow: "var(--note-card-shadow)",
  },
  cardOpen: {
    borderColor: "var(--note-border-strong)",
    boxShadow: "var(--note-card-shadow-open)",
  },
  cardHead: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: "16px 18px",
    cursor: "pointer",
    userSelect: "none",
  },
  cardHeadLeft: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    width: "100%",
  },
  cardTitleFlex: {
    flex: 1,
    minWidth: 0,
  },
  listPin: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    color: "var(--note-pin-color)",
  },
  cardHeadRight: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    flexShrink: 0,
    paddingTop: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "var(--note-text)",
    letterSpacing: "-0.02em",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardSnippet: {
    fontSize: 14,
    color: "var(--note-text-secondary)",
    lineHeight: 1.45,
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 4,
    overflow: "hidden",
    wordBreak: "break-word",
    width: "100%",
    maxWidth: "100%",
    alignSelf: "stretch",
  },
  cardTime: {
    fontSize: 13,
    color: "var(--note-text-tertiary)",
    fontWeight: 500,
  },

  cardToolbar: {
    padding: "10px 12px 12px",
    borderBottomWidth: 0,
    background: "var(--note-surface)",
  },
  toolbarMain: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  toolbarTitleCol: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
    cursor: "text",
  },
  toolbarTitleInput: {
    width: "100%",
    border: "none",
    outline: "none",
    fontSize: 19,
    fontWeight: 600,
    color: "var(--note-text)",
    letterSpacing: "-0.03em",
    background: "transparent",
    fontFamily: "inherit",
    padding: "4px 0 2px",
    lineHeight: 1.25,
  },
  toolbarBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    background: "transparent",
    cursor: "pointer",
    color: "var(--note-text-tertiary)",
    transition: "color 0.12s, border-color 0.12s, background 0.12s",
    padding: 0,
    marginTop: 2,
  },
  toolbarCornerBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    background: "transparent",
    cursor: "pointer",
    color: "var(--note-text-tertiary)",
    transition: "color 0.12s, border-color 0.12s, background 0.12s",
    padding: 0,
  },

  cardBody: {
    display: "flex",
    flexDirection: "column",
    padding: "14px 18px 16px",
    animation: "expandDown 0.2s cubic-bezier(.4,0,.2,1)",
  },

  bodyTime: {
    alignSelf: "flex-end",
    marginTop: 10,
    fontSize: 13,
    color: "var(--note-text-tertiary)",
    fontWeight: 500,
    flexShrink: 0,
    userSelect: "none",
  },

  editBody: {
    width: "100%",
    border: "none",
    outline: "none",
    resize: "none",
    fontSize: 16,
    color: "var(--note-text-body)",
    lineHeight: 1.65,
    background: "transparent",
    fontFamily: "inherit",
    overflow: "hidden",
    minHeight: 100,
    unicodeBidi: "plaintext",
  },

  cardListThumb: {
    width: "100%",
    maxHeight: 160,
    objectFit: "cover",
    borderRadius: 10,
    marginTop: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border-subtle)",
  },
  cardSearchExcerpt: {
    fontSize: 14,
    color: "var(--note-text-secondary)",
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    marginTop: 2,
    wordBreak: "break-word",
  },
  cardAttLabel: {
    fontWeight: 600,
    color: "var(--note-text-tertiary)",
  },
  attachmentsBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 14,
  },
  attachmentImageWrap: {
    position: "relative",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border-subtle)",
    alignSelf: "stretch",
  },
  attachmentImage: {
    width: "100%",
    maxHeight: 320,
    objectFit: "contain",
    display: "block",
    background: "var(--note-surface-muted)",
  },
  attachmentRemove: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    background: "var(--note-surface)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--note-text)",
    padding: 0,
    boxShadow: "var(--note-card-shadow)",
  },
  attachmentFileRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border-subtle)",
    background: "var(--note-surface-muted)",
  },
  attachmentFileName: {
    fontSize: 14,
    color: "var(--note-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  },
  attachmentFileRemove: {
    flexShrink: 0,
    padding: "6px 10px",
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    background: "var(--note-surface)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    color: "var(--note-text)",
  },
  empty: {
    padding: "80px 24px",
    textAlign: "center",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: "var(--note-text-empty)",
    marginBottom: 10,
  },
  emptySub: {
    fontSize: 15,
    color: "var(--note-text-secondary)",
    lineHeight: 1.55,
    maxWidth: 420,
    margin: "0 auto",
  },

  /* recording */
  recCard: {
    position: "fixed",
    bottom: 100,
    right: 20,
    width: 280,
    background: "var(--note-surface)",
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    boxShadow: "var(--note-rec-card-shadow)",
    padding: "18px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    zIndex: 500,
    animation: "slideUp 0.18s ease",
  },
  recRow: { display: "flex", alignItems: "center", gap: 8 },
  recDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--note-danger)",
    display: "inline-block",
    animation: "blink 1s ease-in-out infinite",
  },
  recLbl: {
    fontSize: 11,
    color: "var(--note-text-tertiary)",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  liveTxt: {
    fontSize: 14,
    color: "var(--note-text-empty)",
    lineHeight: 1.5,
    fontStyle: "italic",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: "var(--note-toolbar-border)",
    paddingTop: 10,
    maxHeight: 72,
    overflow: "hidden",
  },
  stopBtn: {
    width: "100%",
    padding: "10px",
    background: "var(--note-accent)",
    border: "none",
    borderRadius: 10,
    color: "var(--note-on-accent)",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    letterSpacing: "0.01em",
  },

  /* modal */
  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--note-overlay)",
    backdropFilter: "blur(5px)",
    zIndex: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 16px",
  },
  modal: {
    background: "var(--note-surface)",
    borderRadius: 16,
    width: "100%",
    maxWidth: 520,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    boxShadow: "var(--note-modal-shadow)",
    padding: "22px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    animation: "modalIn 0.18s ease",
    maxHeight: "min(90dvh, 720px)",
    overflowY: "auto",
  },
  modalTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalHd: {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: "var(--note-text)",
  },
  modalX: {
    background: "var(--note-modal-x-bg)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-modal-x-border)",
    borderRadius: 8,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: "var(--note-modal-x-fg)",
  },
  modalTa: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 15,
    color: "var(--note-text)",
    lineHeight: 1.65,
    resize: "none",
    outline: "none",
    minHeight: 140,
    background: "var(--note-surface-muted)",
    fontFamily: "inherit",
  },
  modalMeta: { display: "flex", flexDirection: "column", gap: 8 },
  modalMetaLbl: {
    fontSize: 12,
    color: "var(--note-text-tertiary)",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  inlineTags: { display: "flex", flexWrap: "wrap", gap: 6 },
  inlineTag: {
    fontSize: 13,
    padding: "5px 12px",
    borderRadius: 999,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
  },
  settingsCopy: {
    fontSize: 14,
    color: "var(--note-text-secondary)",
    lineHeight: 1.55,
    margin: 0,
  },
  settingsFieldLbl: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--note-text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginTop: 12,
    marginBottom: 6,
  },
  settingsSelect: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    background: "var(--note-surface-muted)",
    color: "var(--note-text)",
    fontSize: 14,
    fontFamily: "inherit",
    cursor: "pointer",
  },
  settingsModelInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    background: "var(--note-surface-muted)",
    color: "var(--note-text)",
    fontSize: 14,
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  voiceModalModel: {
    fontSize: 14,
    color: "var(--note-text-secondary)",
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    wordBreak: "break-all",
  },
  voiceModalModelHint: {
    margin: 0,
    fontSize: 12,
    color: "var(--note-text-muted)",
    lineHeight: 1.45,
  },
  settingsList: {
    margin: "12px 0 0",
    paddingLeft: 20,
    fontSize: 14,
    color: "var(--note-text-empty)",
    lineHeight: 1.7,
  },
  settingsHint: {
    fontSize: 13,
    color: "var(--note-text-muted)",
    lineHeight: 1.5,
    margin: "14px 0 0",
  },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 10 },
  btnGhost: {
    padding: "10px 16px",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    background: "var(--note-surface)",
    fontSize: 14,
    fontWeight: 500,
    color: "var(--note-text-empty)",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  btnDark: {
    padding: "10px 18px",
    borderRadius: 10,
    border: "none",
    background: "var(--note-accent)",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--note-on-accent)",
    cursor: "pointer",
    fontFamily: "inherit",
  },

  /* search */
  searchDockWrap: {
    position: "fixed",
    /* bottom + safe area: globals.css (.dock-search) — avoids hydration mismatch */
    left: "50%",
    transform: "translateX(-50%)",
    width: "calc(100vw - 40px)",
    zIndex: 600,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "stretch",
  },
  slashPalette: {
    background: "var(--note-surface)",
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    boxShadow: "var(--note-search-shadow)",
    overflow: "hidden",
    maxHeight: "min(52vh, 320px)",
    display: "flex",
    flexDirection: "column",
  },
  slashPaletteHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "var(--note-border-subtle)",
    background: "var(--note-surface-muted)",
    flexShrink: 0,
  },
  slashPaletteHeaderIcon: {
    display: "flex",
    color: "var(--note-accent)",
    flexShrink: 0,
  },
  slashPaletteHeaderText: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--note-text-secondary)",
  },
  slashPaletteHeaderHint: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--note-text-tertiary)",
    fontWeight: 500,
  },
  slashPaletteList: {
    overflowY: "auto",
    padding: 6,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  slashRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: 10,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.1s",
  },
  slashRowActive: {
    background: "var(--note-accent-soft)",
  },
  slashRowIcon: {
    flexShrink: 0,
    marginTop: 1,
    color: "var(--note-text-tertiary)",
    display: "flex",
  },
  slashRowBody: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  slashRowLabel: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--note-text)",
    letterSpacing: "-0.02em",
  },
  slashRowHint: {
    fontSize: 13,
    color: "var(--note-text-secondary)",
    lineHeight: 1.35,
  },
  searchBar: {
    width: "100%",
    background: "var(--note-surface)",
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    fontSize: 16,
    color: "var(--note-text)",
    fontFamily: "inherit",
    background: "transparent",
    letterSpacing: "-0.01em",
  },
  searchAddBtn: {
    flexShrink: 0,
    padding: "6px 12px",
    borderRadius: 8,
    border: "none",
    background: "var(--note-accent-soft)",
    color: "var(--note-text)",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  clearBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--note-text-tertiary)",
    display: "flex",
    alignItems: "center",
    padding: 4,
    flexShrink: 0,
  },
  kbd: {
    fontSize: 11,
    color: "var(--note-text-tertiary)",
    background: "var(--note-surface-2)",
    padding: "3px 7px",
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-modal-x-border)",
    fontFamily: "inherit",
    flexShrink: 0,
  },
  badge: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--note-text)",
    background: "var(--note-accent-soft)",
    padding: "3px 10px",
    borderRadius: 999,
    flexShrink: 0,
  },
  aiTargetChip: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    maxWidth: 200,
    padding: "4px 6px 4px 8px",
    borderRadius: 8,
    background: "var(--note-accent-soft)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border-subtle)",
  },
  aiTargetChipIcon: {
    display: "flex",
    color: "var(--note-accent)",
    flexShrink: 0,
  },
  aiTargetChipLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--note-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  aiTargetChipClear: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    padding: 0,
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "var(--note-text-tertiary)",
    cursor: "pointer",
  },
  aiFeedback: {
    margin: 0,
    padding: "0 4px 2px",
    fontSize: 12,
    fontWeight: 500,
    color: "var(--note-text-secondary)",
    textAlign: "center",
    lineHeight: 1.35,
  },

  /* fab */
  fab: {
    position: "fixed",
    bottom: 96,
    right: 20,
    minHeight: 52,
    height: "auto",
    padding: "0 20px",
    borderRadius: 999,
    background: "var(--note-accent)",
    border: "none",
    color: "var(--note-on-accent)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "var(--note-fab-shadow)",
    zIndex: 700,
    transition: "transform 0.15s, background 0.15s, box-shadow 0.15s",
    maxWidth: "min(240px, calc(100vw - 40px))",
  },
  fabInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minWidth: 0,
    width: "100%",
  },
  fabLabel: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fabRec: {
    background: "var(--note-danger)",
    boxShadow: "0 6px 24px rgba(180,35,24,0.35)",
    animation: "fabPulse 1.2s ease-in-out infinite",
  },
};

const OpenRouterCredits = dynamic(
  () =>
    import("./components/openrouter-credits").then((m) => ({
      default: m.OpenRouterCredits,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          marginTop: "auto",
          paddingTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 11,
          width: "100%",
          padding: "11px 12px",
          borderRadius: 10,
          opacity: 0.45,
        }}
        aria-hidden
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: "var(--note-sidebar-pill-icon)",
            opacity: 0.25,
          }}
        />
        <span
          style={{
            flex: 1,
            textAlign: "right",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--note-sidebar-pill-fg)",
          }}
        >
          …
        </span>
      </div>
    ),
  },
);

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    min-height: 100%;
    min-height: 100dvh;
    background: var(--note-page-bg) !important;
  }
  ::-webkit-scrollbar { width: 0; height: 0; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes expandDown {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.97) translateY(6px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
  @keyframes fabPulse {
    0%, 100% { box-shadow: 0 6px 24px rgba(180,35,24,0.35); }
    50% { box-shadow: 0 8px 28px rgba(180,35,24,0.45), 0 0 0 8px rgba(180,35,24,0.08); }
  }

  .sidebar-desktop { display: flex; flex-direction: column; }
  .mobile-menu-btn { display: none !important; }

  .sidebar-pill:hover { background: var(--note-sidebar-pill-hover-bg) !important; }
  .sidebar-credits-pill:hover { background: var(--note-sidebar-pill-hover-bg) !important; }
  .note-card:hover { border-color: var(--note-card-hover-border) !important; }
  .inline-tag:hover { filter: brightness(0.96); }
  .app-section-menuitem:hover {
    background: var(--note-sidebar-pill-hover-bg);
  }
  .app-section-trigger-hit:hover {
    background: var(--note-sidebar-pill-hover-bg);
  }
  /* ChatGPT-style: bold visible title + muted chevron (label must not collapse in grid). */
  .app-section-current-label {
    font-size: 1.375rem !important;
    font-weight: 700 !important;
    letter-spacing: -0.03em !important;
    color: var(--note-text) !important;
    line-height: 1.2 !important;
    white-space: nowrap !important;
    flex-shrink: 0 !important;
  }
  .app-section-chevron {
    color: var(--note-text-tertiary) !important;
    opacity: 0.85 !important;
  }
  .app-section-trigger-hit {
    -webkit-appearance: none !important;
    appearance: none !important;
  }
  .search-add-hover:hover { filter: brightness(0.95); }
  .pin-btn:hover {
    color: var(--note-pin-active) !important;
    background: var(--note-pin-hover-bg) !important;
    border-color: var(--note-pin-hover-border) !important;
  }

  @media (max-width: 768px) {
    .sidebar-desktop { display: none !important; }
    .mobile-menu-btn { display: flex !important; }
  }

  /* Search was viewport-centered; notes live in the column right of the 272px sidebar. */
  @media (min-width: 769px) {
    .dock-search {
      left: calc(50vw + 136px) !important;
      width: calc(100vw - 272px - 32px) !important;
    }
  }

  .note-drop-zone { transition: box-shadow 0.15s, background 0.15s; border-radius: 0 0 12px 12px; }
  .note-drop-zone--active {
    box-shadow: inset 0 0 0 2px var(--note-accent) !important;
    background: var(--note-accent-soft) !important;
  }

  @media (max-width: 560px) {
    .dock-search { width: calc(100vw - 24px) !important; max-width: none !important; }
  }
  .del-btn:hover {
    color: var(--note-del-hover-color) !important;
    border-color: var(--note-del-hover-border) !important;
    background: var(--note-del-hover-bg) !important;
  }
  .restore-btn:hover {
    color: var(--note-text) !important;
    background: var(--note-surface-muted) !important;
  }
  .fab:hover { transform: scale(1.03) !important; }
  .fab:active { transform: scale(0.98) !important; }
  .stop-btn:hover { background: var(--note-stop-hover) !important; }

  button:focus-visible { outline: 2px solid var(--note-focus-ring); outline-offset: 2px; }
  input::placeholder, textarea::placeholder { color: var(--note-text-muted); }

  .traffic-light-hit:hover .traffic-dot-visual { filter: brightness(1.12); }
`;
