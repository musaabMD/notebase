import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

const attachmentIn = v.object({
  id: v.string(),
  kind: v.union(v.literal("image"), v.literal("file")),
  name: v.string(),
  mime: v.string(),
  storageId: v.id("_storage"),
});

const historyIn = v.object({
  title: v.string(),
  content: v.string(),
  savedAt: v.number(),
});

async function hydrateAttachments(
  ctx: { storage: { getUrl: (id: string) => Promise<string | null> } },
  attachments: Array<{
    id: string;
    kind: "image" | "file";
    name: string;
    mime: string;
    storageId: string;
  }>
) {
  return Promise.all(
    attachments.map(async (a) => ({
      ...a,
      url: await ctx.storage.getUrl(a.storageId),
    }))
  );
}

const DEFAULT_PAGE_SIZE = 50;

export const list = query({
  args: { paginationOpts: v.optional(paginationOptsValidator) },
  handler: async (ctx, args) => {
    const paginationOpts = args.paginationOpts ?? { numItems: DEFAULT_PAGE_SIZE, cursor: null };
    const result = await ctx.db
      .query("notes")
      .withIndex("by_createdAt")
      .order("desc")
      .paginate(paginationOpts);

    const hydrated = await Promise.all(
      result.page.map(async (n) => ({
        ...n,
        attachments: await hydrateAttachments(ctx, n.attachments),
      }))
    );

    return { ...result, page: hydrated };
  },
});

export const get = query({
  args: { id: v.id("notes") },
  handler: async (ctx, { id }) => {
    const n = await ctx.db.get(id);
    if (!n) return null;
    return {
      ...n,
      attachments: await hydrateAttachments(ctx, n.attachments),
    };
  },
});

export const listByTag = query({
  args: {
    tag: v.string(),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, args) => {
    const paginationOpts = args.paginationOpts ?? { numItems: DEFAULT_PAGE_SIZE, cursor: null };
    const result = await ctx.db
      .query("notes")
      .withIndex("by_tag_and_createdAt", (q) => q.eq("tag", args.tag))
      .order("desc")
      .paginate(paginationOpts);

    const hydrated = await Promise.all(
      result.page.map(async (n) => ({
        ...n,
        attachments: await hydrateAttachments(ctx, n.attachments),
      }))
    );

    return { ...result, page: hydrated };
  },
});

export const create = mutation({
  args: {
    tag: v.string(),
    title: v.string(),
    content: v.string(),
    createdAt: v.number(),
    pinned: v.optional(v.boolean()),
    attachments: v.optional(v.array(attachmentIn)),
    contentHistory: v.optional(v.array(historyIn)),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("notes", {
      tag: args.tag,
      title: args.title,
      content: args.content,
      createdAt: args.createdAt,
      pinned: args.pinned ?? false,
      attachments: args.attachments ?? [],
      contentHistory: args.contentHistory ?? [],
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("notes"),
    tag: v.optional(v.string()),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    pinned: v.optional(v.boolean()),
    attachments: v.optional(v.array(attachmentIn)),
    contentHistory: v.optional(v.array(historyIn)),
  },
  handler: async (ctx, { id, ...patch }) => {
    const cur = await ctx.db.get(id);
    if (!cur) throw new Error("Note not found");
    const next = { ...cur };
    if (patch.tag !== undefined) next.tag = patch.tag;
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.content !== undefined) next.content = patch.content;
    if (patch.createdAt !== undefined) next.createdAt = patch.createdAt;
    if (patch.pinned !== undefined) next.pinned = patch.pinned;
    if (patch.attachments !== undefined) {
      const removed = cur.attachments.filter(
        (a) => !patch.attachments!.some((b) => b.storageId === a.storageId)
      );
      for (const a of removed) {
        await ctx.storage.delete(a.storageId);
      }
      next.attachments = patch.attachments;
    }
    if (patch.contentHistory !== undefined) next.contentHistory = patch.contentHistory;
    await ctx.db.replace(id, next);
  },
});

export const remove = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, { id }) => {
    const n = await ctx.db.get(id);
    if (!n) return;
    for (const a of n.attachments) {
      await ctx.storage.delete(a.storageId);
    }
    await ctx.db.delete(id);
  },
});

/** Step 1 of file flow: upload bytes to the returned URL, then pass `storageId` into create/update. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
