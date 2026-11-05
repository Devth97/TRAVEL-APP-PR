import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.hourly("purge expired sessions", { minuteUTC: 17 }, internal.sessions.purgeExpired, {});
export default crons;
