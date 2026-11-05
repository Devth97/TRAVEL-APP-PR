import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Only sign-in state lives in Convex. Employees, grades and travel requests stay in ERP.
export default defineSchema({
  sessions: defineTable({
    tokenHash: v.string(),
    email: v.string(),
    employeeId: v.string(),
    method: v.string(), // "microsoft" | "uat-passcode"
    expiresAt: v.number(),
  }).index("by_tokenHash", ["tokenHash"]),
  oauthStates: defineTable({
    state: v.string(),
    verifier: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
