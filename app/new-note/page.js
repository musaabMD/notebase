"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useConvexDeploymentUrl } from "../convex-client-provider";

const CloseIcon = () => (
  <svg
    width="18"
    height="18"
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

const CheckIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const BackIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

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

function tagFromHashtagInNoteText(title, content) {
  const text = `${title ?? ""}\n${content ?? ""}`;
  const re = /(?:^|[\s])#([a-zA-Z0-9_-]+)/g;
  const m = re.exec(text);
  if (!m) return "";
  return m[1].toLowerCase();
}

const MAX_CONTENT_CHARS = 100_000;

export default function NewNotePage() {
  const router = useRouter();
  const convexDeploymentUrl = useConvexDeploymentUrl();
  const useConvexDb = Boolean(convexDeploymentUrl);
  const createNoteConvex = useMutation(api.notes.create);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tag, setTag] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const titleRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleTitleChange = (e) => {
    setTitle(e.target.value);
    setHasChanges(true);
  };

  const handleContentChange = (e) => {
    const val = e.target.value;
    if (val.length <= MAX_CONTENT_CHARS) {
      setContent(val);
      setHasChanges(true);
    }
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleBack = useCallback(() => {
    if (hasChanges) {
      if (confirm("Discard unsaved note?")) {
        router.back();
      }
    } else {
      router.back();
    }
  }, [hasChanges, router]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);

    try {
      const derivedTag = tagFromHashtagInNoteText(title, content);
      const finalTag = derivedTag || tag || "";
      const { title: finalTitle, content: finalContent } =
        titleAndBodyFromPlainText(
          title || content || `Note ${new Date().toLocaleString()}`
        );

      if (useConvexDb) {
        await createNoteConvex({
          tag: finalTag,
          title: finalTitle.slice(0, 200),
          content: finalContent.slice(0, MAX_CONTENT_CHARS),
          createdAt: Date.now(),
          pinned: false,
        });
      } else {
        const notes = JSON.parse(localStorage.getItem("note-app-notes-v1") || "[]");
        const newNote = {
          id: Date.now(),
          tag: finalTag,
          title: finalTitle.slice(0, 200),
          content: finalContent.slice(0, MAX_CONTENT_CHARS),
          createdAt: new Date().toISOString(),
          pinned: false,
          attachments: [],
          contentHistory: [],
        };
        notes.unshift(newNote);
        localStorage.setItem("note-app-notes-v1", JSON.stringify(notes));
      }

      router.replace("/");
    } catch (err) {
      console.error("Failed to save note:", err);
      setSaving(false);
    }
  }, [saving, title, content, tag, useConvexDb, createNoteConvex, router]);

  const suggestedTags = ["work", "personal", "ideas", "tasks"];

  return (
    <div className="new-note-page">
      <style>{`
        .new-note-page {
          min-height: 100dvh;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--note-main-bg, #f5f4f1);
          font-family: var(--font-geist-sans), system-ui, -apple-system, sans-serif;
        }
        .new-note-header {
          position: sticky;
          top: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          padding-top: calc(12px + env(safe-area-inset-top, 0px));
          background: var(--note-surface, #fff);
          border-bottom: 1px solid var(--note-border, #d4d1cc);
        }
        .new-note-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: none;
          background: transparent;
          cursor: pointer;
          border-radius: 10px;
          color: var(--note-text, #1a1a1a);
        }
        .new-note-back-btn:hover {
          background: var(--note-accent-soft, #ebe8e4);
        }
        .new-note-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .new-note-preview-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px 16px;
          border: 1px solid var(--note-border, #d4d1cc);
          background: var(--note-surface, #fff);
          cursor: pointer;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          color: var(--note-text, #1a1a1a);
          font-family: inherit;
        }
        .new-note-preview-btn:hover {
          background: var(--note-surface-muted, #fafaf9);
        }
        .new-note-preview-btn.active {
          background: var(--note-accent, #1a1a1a);
          color: var(--note-on-accent, #fff);
          border-color: var(--note-accent, #1a1a1a);
        }
        .new-note-save-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 18px;
          border: none;
          background: var(--note-accent, #1a1a1a);
          color: var(--note-on-accent, #fff);
          cursor: pointer;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
        }
        .new-note-save-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .new-note-save-btn:not(:disabled):hover {
          opacity: 0.9;
        }
        .new-note-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 16px;
          gap: 12px;
        }
        .new-note-title {
          width: 100%;
          border: none;
          outline: none;
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--note-text, #1a1a1a);
          background: transparent;
          font-family: inherit;
          padding: 0;
          resize: none;
          min-height: 36px;
        }
        .new-note-content {
          width: 100%;
          flex: 1;
          border: none;
          outline: none;
          font-size: 16px;
          line-height: 1.65;
          color: var(--note-text-body, #292929);
          background: transparent;
          font-family: inherit;
          padding: 0;
          resize: none;
          min-height: 200px;
          word-break: break-word;
        }
        .new-note-title::placeholder,
        .new-note-content::placeholder {
          color: var(--note-text-muted, #8a8884);
        }
        .new-note-preview {
          flex: 1;
          font-size: 16px;
          line-height: 1.65;
          color: var(--note-text-body, #292929);
          overflow-y: auto;
          padding: 0 4px;
        }
        .new-note-preview > *:first-child { margin-top: 0 !important; }
        .new-note-preview > *:last-child { margin-bottom: 0 !important; }
        .new-note-preview h1 { font-size: 1.35rem; font-weight: 700; margin: 1em 0 0.5em; letter-spacing: -0.02em; }
        .new-note-preview h2 { font-size: 1.2rem; font-weight: 700; margin: 1em 0 0.45em; letter-spacing: -0.02em; }
        .new-note-preview h3 { font-size: 1.08rem; font-weight: 650; margin: 0.9em 0 0.4em; }
        .new-note-preview p { margin: 0 0 0.65em; }
        .new-note-preview ul, .new-note-preview ol { margin: 0 0 0.65em; padding-left: 1.35em; }
        .new-note-preview li { margin: 0.25em 0; }
        .new-note-preview blockquote {
          margin: 0.65em 0;
          padding-left: 1em;
          border-left: 3px solid var(--note-border-strong, #ccc);
          color: var(--note-text-secondary, #525252);
        }
        .new-note-preview code {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
          font-size: 0.9em;
          padding: 0.12em 0.35em;
          border-radius: 4px;
          background: var(--note-surface-muted, #fafaf9);
        }
        .new-note-preview pre {
          margin: 0.65em 0;
          padding: 12px 14px;
          border-radius: 10px;
          background: var(--note-surface-muted, #fafaf9);
          border: 1px solid var(--note-border-subtle, #e8e6e3);
          overflow-x: auto;
        }
        .new-note-preview pre code { padding: 0; background: none; border-radius: 0; }
        .new-note-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 12px 0;
          border-top: 1px solid var(--note-border-subtle, #e8e6e3);
        }
        .new-note-tag-label {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--note-text-tertiary, #737373);
          align-self: center;
          margin-right: 4px;
        }
        .new-note-tag-btn {
          padding: 6px 14px;
          border-radius: 999px;
          border: 1px solid var(--note-border, #d4d1cc);
          background: var(--note-surface, #fff);
          font-size: 13px;
          font-weight: 500;
          color: var(--note-text, #1a1a1a);
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .new-note-tag-btn:hover {
          border-color: var(--note-accent, #1a1a1a);
        }
        .new-note-tag-btn.selected {
          background: var(--note-accent, #1a1a1a);
          color: var(--note-on-accent, #fff);
          border-color: var(--note-accent, #1a1a1a);
        }
        .new-note-hint {
          font-size: 12px;
          color: var(--note-text-muted, #8a8884);
          padding: 8px 0 0;
        }
        @media (min-width: 769px) {
          .new-note-page {
            display: none;
          }
        }
      `}</style>

      <header className="new-note-header">
        <button
          className="new-note-back-btn"
          onClick={handleBack}
          aria-label="Go back"
        >
          <BackIcon />
        </button>
        <div className="new-note-actions">
          <button
            className={`new-note-preview-btn ${showPreview ? "active" : ""}`}
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? "Edit" : "Preview"}
          </button>
          <button
            className="new-note-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              "Saving..."
            ) : (
              <>
                <CheckIcon />
                Save
              </>
            )}
          </button>
        </div>
      </header>

      <div className="new-note-body">
        {showPreview ? (
          <div className="new-note-preview">
            {content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {content}
              </ReactMarkdown>
            ) : (
              <p style={{ color: "var(--note-text-muted)" }}>
                Nothing to preview yet.
              </p>
            )}
          </div>
        ) : (
          <>
            <textarea
              ref={titleRef}
              className="new-note-title"
              placeholder="Title"
              value={title}
              onChange={handleTitleChange}
              rows={1}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
            />
            <textarea
              ref={contentRef}
              className="new-note-content"
              placeholder="Start writing..."
              value={content}
              onChange={handleContentChange}
            />
          </>
        )}

        {!showPreview && (
          <div className="new-note-tags">
            <span className="new-note-tag-label">Notebook:</span>
            {suggestedTags.map((t) => (
              <button
                key={t}
                className={`new-note-tag-btn ${tag === t ? "selected" : ""}`}
                onClick={() => setTag(tag === t ? "" : t)}
              >
                #{t}
              </button>
            ))}
            <button
              className={`new-note-tag-btn ${tag && !suggestedTags.includes(tag) ? "selected" : ""}`}
              onClick={() => {
                const newTag = prompt("Enter notebook name:");
                if (newTag?.trim()) {
                  setTag(newTag.trim().toLowerCase().replace(/^#/, ""));
                }
              }}
            >
              + Custom
            </button>
          </div>
        )}

        {!showPreview && (
          <p className="new-note-hint">
            Tip: Add #hashtags in your text to auto-tag notes
          </p>
        )}
      </div>
    </div>
  );
}
