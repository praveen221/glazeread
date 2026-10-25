import path from "node:path";
import { joinSession } from "../server/joinSession.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npm run join -- data/sessions/<session_id>");
  process.exit(1);
}

const summary = await joinSession(path.resolve(dir));
console.log(JSON.stringify(summary, null, 2));
