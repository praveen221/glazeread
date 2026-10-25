import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const indexPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "sessions",
  "index.jsonl",
);

if (!fs.existsSync(indexPath)) {
  console.log("No sessions yet. Start the app and press Record.");
  process.exit(0);
}

const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter(Boolean);
console.log(`${lines.length} session(s)`);
for (const line of lines) {
  const row = JSON.parse(line);
  const summary = row.summary && typeof row.summary === "object" ? row.summary : {};
  const seconds = Math.round((summary.duration_ms ?? 0) / 1000);
  const coverage =
    typeof summary.line_coverage === "number" ? `${Math.round(summary.line_coverage * 100)}%` : "—";
  const fault = row.fault ? `  fault=${row.fault}` : "";
  console.log(
    `${row.session_id}  ${seconds}s  gaze=${summary.gaze_samples ?? 0}  line=${coverage}  eyes=${summary.eyes_samples ?? 0}  labels=${summary.strong_events ?? 0}  camera=${summary.camera_bytes ?? 0}B  voice=${summary.voice_bytes ?? 0}B${fault}`,
  );
}
