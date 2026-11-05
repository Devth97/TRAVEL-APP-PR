import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const saveOAuthState = internalMutation({
  args: { state: v.string(), verifier: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("oauthStates", args);
  },
});

/** One-time use: returns the PKCE verifier and deletes the state. */
export const takeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db.query("oauthStates").withIndex("by_state", (q) => q.eq("state", state)).unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row.expiresAt > Date.now() ? row.verifier : null;
  },
});

export const createSession = internalMutation({
  args: { tokenHash: v.string(), email: v.string(), employeeId: v.string(), method: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("sessions", args);
  },
});

export const getSession = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const s = await ctx.db.query("sessions").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!s || s.expiresAt < Date.now()) return null;
    return { email: s.email, employeeId: s.employeeId, method: s.method, expiresAt: s.expiresAt };
  },
});

export const deleteSession = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const s = await ctx.db.query("sessions").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (s) await ctx.db.delete(s._id);
  },
});

/** Housekeeping: remove expired sessions and OAuth states (scheduled in crons.ts). */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const table of ["sessions", "oauthStates"] as const) {
      const rows = await ctx.db.query(table).take(500);
      for (const r of rows) if (r.expiresAt < now) await ctx.db.delete(r._id);
    }
  },
});
