import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// App-owned root routing: the /api/... routes in convex/http.ts are exact routes and win;
// everything else falls through to the static site uploaded by @convex-dev/static-hosting.
const app = defineApp();
app.use(staticHosting);

export default app;
