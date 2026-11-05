import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
// Plain-JS modules shared with the unit tests and the local mock server.
import { handleApi, ROUTES, PREFIX_ROUTES } from "./lib/api.js";
import { createErpClient } from "./lib/erp.js";

const api = httpAction(async (ctx, request) =>
  handleApi(request, {
    env: process.env,
    erp: createErpClient(process.env, fetch),
    fetch,
    now: () => Date.now(),
    store: {
      saveState: (a: { state: string; verifier: string; expiresAt: number }) => ctx.runMutation(internal.sessions.saveOAuthState, a),
      takeState: (a: { state: string }) => ctx.runMutation(internal.sessions.takeOAuthState, a),
      createSession: (a: { tokenHash: string; email: string; employeeId: string; method: string; expiresAt: number }) =>
        ctx.runMutation(internal.sessions.createSession, a),
      getSession: (tokenHash: string) => ctx.runQuery(internal.sessions.getSession, { tokenHash }),
      deleteSession: (a: { tokenHash: string }) => ctx.runMutation(internal.sessions.deleteSession, a),
    },
  }),
);

const http = httpRouter();
for (const [method, path] of ROUTES as [string, string][]) {
  http.route({ path, method: method as "GET" | "POST", handler: api });
}
for (const [method, pathPrefix] of PREFIX_ROUTES as [string, string][]) {
  http.route({ pathPrefix, method: method as "GET", handler: api });
}

// Everything else is the static web app (uploaded with @convex-dev/static-hosting).
registerStaticRoutes(http, components.staticHosting);

export default http;
