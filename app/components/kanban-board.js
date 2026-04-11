"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const KANBAN_LOCAL_KEY = "noteapp-kanban-v1";

export const KANBAN_BOARDS = {
  tasks: {
    title: "Tasks",
    columns: [
      { key: "todo", label: "To do" },
      { key: "doing", label: "In progress" },
      { key: "done", label: "Done" },
    ],
  },
  debt: {
    title: "Debt",
    columns: [
      { key: "planned", label: "Planned" },
      { key: "active", label: "Paying" },
      { key: "paid", label: "Paid" },
    ],
  },
};

function loadLocalBoard(board) {
  try {
    const raw = localStorage.getItem(KANBAN_LOCAL_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw);
    return Array.isArray(all[board]) ? all[board] : [];
  } catch {
    return [];
  }
}

function saveLocalBoard(board, cards) {
  try {
    const raw = localStorage.getItem(KANBAN_LOCAL_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[board] = cards;
    localStorage.setItem(KANBAN_LOCAL_KEY, JSON.stringify(all));
  } catch {
    /* noop */
  }
}

const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 280,
    padding: "4px 0 24px",
  },
  head: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--note-text-secondary)",
  },
  boardRow: {
    display: "flex",
    gap: 12,
    overflowX: "auto",
    paddingBottom: 8,
    scrollbarWidth: "thin",
  },
  column: {
    flex: "0 0 min(280px, 82vw)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: "min(70vh, 560px)",
    borderRadius: 12,
    padding: 10,
    background: "var(--note-surface-muted)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border-subtle)",
  },
  colTitle: {
    margin: 0,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--note-text-tertiary)",
  },
  colList: {
    flex: 1,
    minHeight: 80,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  card: {
    borderRadius: 10,
    padding: "10px 12px",
    background: "var(--note-surface)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    boxShadow: "var(--note-card-shadow)",
    cursor: "grab",
    position: "relative",
  },
  cardDragging: { opacity: 0.55 },
  cardTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--note-text)",
    lineHeight: 1.35,
    wordBreak: "break-word",
  },
  cardDesc: {
    margin: "6px 0 0",
    fontSize: 12,
    lineHeight: 1.4,
    color: "var(--note-text-secondary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  cardDel: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "var(--note-text-tertiary)",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
  },
  addBtn: {
    flexShrink: 0,
    marginTop: 4,
    padding: "8px 10px",
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "var(--note-border)",
    background: "transparent",
    color: "var(--note-text-secondary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
  },
  addForm: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    background: "var(--note-surface)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
  },
  addInput: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--note-border)",
    background: "var(--note-surface-muted)",
    color: "var(--note-text)",
    fontSize: 14,
    fontFamily: "inherit",
    padding: "8px 10px",
    outline: "none",
  },
  addActions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
  },
  addPrimary: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "none",
    background: "var(--note-accent)",
    color: "var(--note-on-accent)",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  addGhost: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "var(--note-text-secondary)",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  loading: {
    fontSize: 14,
    color: "var(--note-text-secondary)",
    padding: "12px 0",
  },
};

function boardSubtitle(board, useConvexDb) {
  const sync = useConvexDb
    ? "Synced with Convex."
    : "Stored in this browser only (add Convex in .env to sync).";
  if (board === "debt") {
    return `Planned → Paying → Paid. ${sync}`;
  }
  return `To do → In progress → Done. ${sync}`;
}

export function KanbanBoard({ board, useConvexDb }) {
  const def = KANBAN_BOARDS[board];
  const convexCards = useQuery(
    api.kanbanCards.listByBoard,
    useConvexDb ? { board } : "skip"
  );
  const createConvex = useMutation(api.kanbanCards.create);
  const moveConvex = useMutation(api.kanbanCards.move);
  const removeConvex = useMutation(api.kanbanCards.remove);
  const updateConvex = useMutation(api.kanbanCards.update);

  const [localCards, setLocalCards] = useState(() =>
    typeof window === "undefined" ? [] : loadLocalBoard(board)
  );
  const [localReady, setLocalReady] = useState(false);

  useEffect(() => {
    if (useConvexDb) return;
    setLocalCards(loadLocalBoard(board));
    setLocalReady(true);
  }, [board, useConvexDb]);

  useEffect(() => {
    if (useConvexDb || !localReady) return;
    saveLocalBoard(board, localCards);
  }, [board, localCards, localReady, useConvexDb]);

  const cards = useMemo(() => {
    if (useConvexDb) {
      if (convexCards === undefined) return null;
      return convexCards;
    }
    return localCards;
  }, [useConvexDb, convexCards, localCards]);

  const byColumn = useMemo(() => {
    if (!cards) return {};
    const m = {};
    for (const col of def.columns) {
      m[col.key] = [];
    }
    for (const c of cards) {
      const key = c.columnKey;
      if (!m[key]) m[key] = [];
      m[key].push(c);
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => a.order - b.order);
    }
    return m;
  }, [cards, def.columns]);

  const [dragId, setDragId] = useState(null);
  const [addingCol, setAddingCol] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");

  const cardKey = useCallback(
    (c) => (useConvexDb ? String(c._id) : c.id),
    [useConvexDb]
  );

  const onAdd = useCallback(
    async (columnKey) => {
      const title = draftTitle.trim();
      if (!title) return;
      if (useConvexDb) {
        await createConvex({ board, columnKey, title });
      } else {
        const id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setLocalCards((prev) => {
          const order =
            prev
              .filter((x) => x.columnKey === columnKey)
              .reduce((m, x) => Math.max(m, x.order), 0) + 1;
          return [
            ...prev,
            {
              id,
              columnKey,
              title,
              description: "",
              order,
              createdAt: Date.now(),
            },
          ];
        });
      }
      setDraftTitle("");
      setAddingCol(null);
    },
    [board, createConvex, draftTitle, useConvexDb]
  );

  const onMove = useCallback(
    async (cardId, columnKey) => {
      if (useConvexDb) {
        await moveConvex({ id: cardId, columnKey });
      } else {
        setLocalCards((prev) => {
          const cur = prev.find((x) => x.id === cardId);
          if (!cur || cur.columnKey === columnKey) return prev;
          const inTarget = prev.filter(
            (x) => x.columnKey === columnKey && x.id !== cardId
          );
          const order =
            inTarget.reduce((m, x) => Math.max(m, x.order), 0) + 1;
          return prev.map((x) =>
            x.id === cardId ? { ...x, columnKey, order } : x
          );
        });
      }
    },
    [moveConvex, useConvexDb]
  );

  const onRemove = useCallback(
    async (cardId) => {
      if (useConvexDb) {
        await removeConvex({ id: cardId });
      } else {
        setLocalCards((prev) => prev.filter((x) => x.id !== cardId));
      }
    },
    [removeConvex, useConvexDb]
  );

  const [editing, setEditing] = useState(null);
  const [editTitle, setEditTitle] = useState("");

  const startEdit = useCallback((c) => {
    setEditing(cardKey(c));
    setEditTitle(c.title);
  }, [cardKey]);

  const commitEdit = useCallback(
    async (c) => {
      const next = editTitle.trim();
      setEditing(null);
      if (!next || next === c.title) return;
      if (useConvexDb) {
        await updateConvex({ id: c._id, title: next });
      } else {
        setLocalCards((prev) =>
          prev.map((x) => (x.id === c.id ? { ...x, title: next } : x))
        );
      }
    },
    [editTitle, updateConvex, useConvexDb]
  );

  if (useConvexDb && cards === null) {
    return <p style={s.loading}>Loading board…</p>;
  }

  return (
    <div style={s.wrap}>
      <p style={s.head}>{boardSubtitle(board, useConvexDb)}</p>
      <div style={s.boardRow} className="kanban-board-row">
        {def.columns.map((col) => (
          <div
            key={col.key}
            style={s.column}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/kanban-id");
              if (id) onMove(id, col.key);
            }}
          >
            <h3 style={s.colTitle}>{col.label}</h3>
            <div style={s.colList}>
              {(byColumn[col.key] || []).map((c) => {
                const id = cardKey(c);
                const isDrag = dragId === id;
                return (
                  <div
                    key={id}
                    draggable
                    style={{ ...s.card, ...(isDrag ? s.cardDragging : {}) }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/kanban-id", id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(id);
                    }}
                    onDragEnd={() => setDragId(null)}
                  >
                    <button
                      type="button"
                      style={s.cardDel}
                      aria-label="Remove card"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onRemove(useConvexDb ? String(c._id) : c.id);
                      }}
                    >
                      ×
                    </button>
                    {editing === id ? (
                      <textarea
                        style={{
                          ...s.addInput,
                          minHeight: 56,
                          resize: "vertical",
                        }}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => commitEdit(c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            commitEdit(c);
                          }
                          if (e.key === "Escape") setEditing(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <p
                        style={s.cardTitle}
                        role="button"
                        tabIndex={0}
                        onClick={() => startEdit(c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            startEdit(c);
                          }
                        }}
                      >
                        {c.title}
                      </p>
                    )}
                    {c.description ? (
                      <p style={s.cardDesc}>{c.description}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {addingCol === col.key ? (
              <div style={s.addForm}>
                <input
                  style={s.addInput}
                  placeholder="Title"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onAdd(col.key);
                    if (e.key === "Escape") {
                      setAddingCol(null);
                      setDraftTitle("");
                    }
                  }}
                  autoFocus
                />
                <div style={s.addActions}>
                  <button
                    type="button"
                    style={s.addGhost}
                    onClick={() => {
                      setAddingCol(null);
                      setDraftTitle("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={s.addPrimary}
                    onClick={() => onAdd(col.key)}
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                style={s.addBtn}
                onClick={() => setAddingCol(col.key)}
              >
                + Add a card
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
