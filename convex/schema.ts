import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Binary assets live in Convex File Storage; rows only store `storageId` + metadata. */
const noteAttachment = v.object({
  id: v.string(),
  kind: v.union(v.literal("image"), v.literal("file")),
  name: v.string(),
  mime: v.string(),
  storageId: v.id("_storage"),
});

const contentHistoryEntry = v.object({
  title: v.string(),
  content: v.string(),
  savedAt: v.number(),
});

export default defineSchema({
  notes: defineTable({
    tag: v.string(),
    title: v.string(),
    content: v.string(),
    /** UTC ms — mirrors your client `createdAt` ordering. */
    createdAt: v.number(),
    pinned: v.boolean(),
    attachments: v.array(noteAttachment),
    contentHistory: v.array(contentHistoryEntry),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_tag_and_createdAt", ["tag", "createdAt"]),

  /** Trello-style cards for Tasks and Debt HQ sections. */
  kanbanCards: defineTable({
    board: v.union(v.literal("tasks"), v.literal("debt")),
    columnKey: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    order: v.number(),
    createdAt: v.number(),
  }).index("by_board", ["board"]),
});
