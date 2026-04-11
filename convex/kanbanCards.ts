import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";

const boardV = v.union(v.literal("tasks"), v.literal("debt"));

async function nextOrder(
  ctx: MutationCtx,
  board: "tasks" | "debt",
  columnKey: string
) {
  const cards = await ctx.db
    .query("kanbanCards")
    .withIndex("by_board", (q) => q.eq("board", board))
    .collect();
  const inCol = cards.filter((c) => c.columnKey === columnKey);
  const max = inCol.reduce((m, c) => Math.max(m, c.order), 0);
  return max + 1;
}

export const listByBoard = query({
  args: { board: boardV },
  handler: async (ctx, { board }) => {
    const cards = await ctx.db
      .query("kanbanCards")
      .withIndex("by_board", (q) => q.eq("board", board))
      .collect();
    cards.sort((a, b) => {
      if (a.columnKey !== b.columnKey) {
        return a.columnKey.localeCompare(b.columnKey);
      }
      return a.order - b.order;
    });
    return cards;
  },
});

export const create = mutation({
  args: {
    board: boardV,
    columnKey: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const order = await nextOrder(ctx, args.board, args.columnKey);
    return await ctx.db.insert("kanbanCards", {
      board: args.board,
      columnKey: args.columnKey,
      title: args.title,
      description: args.description,
      order,
      createdAt,
    });
  },
});

export const move = mutation({
  args: {
    id: v.id("kanbanCards"),
    columnKey: v.string(),
  },
  handler: async (ctx, { id, columnKey }) => {
    const card = await ctx.db.get(id);
    if (!card) throw new Error("Card not found");
    if (card.columnKey === columnKey) return;
    const order = await nextOrder(ctx, card.board, columnKey);
    await ctx.db.patch(id, { columnKey, order });
  },
});

export const update = mutation({
  args: {
    id: v.id("kanbanCards"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const cur = await ctx.db.get(id);
    if (!cur) throw new Error("Card not found");
    const next = { ...cur };
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.description !== undefined) next.description = patch.description;
    await ctx.db.replace(id, next);
  },
});

export const remove = mutation({
  args: { id: v.id("kanbanCards") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
