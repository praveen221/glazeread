import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

/**
 * Build examples.jsonl from one closed (or open) session directory.
 * Join rules, glaze.example.v1:
 * - Every gaze row becomes one example.
 * - Reading context is the latest tick/focus row with t_ms <= gaze.t_ms (hold).
 * - Eyes attach when an eyes row is within 150ms.
 * - A teach/confirm event labels only the single nearest gaze row within 400ms.
 */
export async function joinSession(dir) {
  const gazeFile = await readJsonl(path.join(dir, "gaze.jsonl"));
  const readingFile = await readJsonl(path.join(dir, "reading.jsonl"));
  const eyesFile = await readJsonl(path.join(dir, "eyes.jsonl"));
  const eventsFile = await readJsonl(path.join(dir, "events.jsonl"));

  const gaze = gazeFile.rows
    .filter((row) => typeof row.t_ms === "number")
    .sort((a, b) => a.t_ms - b.t_ms);
  const reading = readingFile.rows
    .filter(
      (row) =>
        typeof row.t_ms === "number" && (row.kind === "tick" || row.kind === "focus"),
    )
    .sort((a, b) => a.t_ms - b.t_ms);
  const eyes = eyesFile.rows
    .filter((row) => typeof row.t_ms === "number")
    .sort((a, b) => a.t_ms - b.t_ms);
  const strong = eventsFile.rows
    .filter(
      (row) =>
        typeof row.t_ms === "number" && (row.type === "teach" || row.type === "confirm"),
    )
    .sort((a, b) => a.t_ms - b.t_ms);

  const labels = new Array(gaze.length).fill(null);
  const labelDt = new Array(gaze.length).fill(Infinity);
  for (const event of strong) {
    const index = nearestIndex(gaze, event.t_ms);
    if (index < 0) continue;
    const dt = Math.abs(gaze[index].t_ms - event.t_ms);
    if (dt > 400 || dt >= labelDt[index]) continue;
    labelDt[index] = dt;
    labels[index] = event;
  }

  let sessionId = path.basename(dir);
  const manifestPath = path.join(dir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest && typeof manifest.session_id === "string") sessionId = manifest.session_id;
    } catch {
      /* basename stays */
    }
  }

  const out = fs.createWriteStream(path.join(dir, "examples.jsonl"));
  let withLine = 0;
  let withEyes = 0;
  let withStrong = 0;
  let face = 0;
  let confSum = 0;
  const stateMs = { READING: 0, SEARCHING: 0, AWAY: 0, HESITATING: 0 };

  for (let i = 0; i < gaze.length; i++) {
    const g = gaze[i];
    const nextT = i + 1 < gaze.length ? gaze[i + 1].t_ms : g.t_ms;
    const dt = Math.max(0, nextT - g.t_ms);
    if (Object.prototype.hasOwnProperty.call(stateMs, g.state)) stateMs[g.state] += dt;
    if (g.face) face += 1;
    if (typeof g.confidence === "number") confSum += g.confidence;

    const heldIndex = holdIndex(reading, g.t_ms);
    const read = heldIndex >= 0 ? reading[heldIndex] : null;
    const eye = nearestWithin(eyes, g.t_ms, 150);
    const label = labels[i];
    const lineText = nonempty(g.line_text) ?? nonempty(read?.line_text);
    const hasLine = !!lineText;
    if (hasLine) withLine += 1;
    if (eye) withEyes += 1;

    let strongLabel = null;
    if (label) {
      withStrong += 1;
      strongLabel =
        label.type === "teach"
          ? {
              kind: "teach",
              x: label.x ?? null,
              y: label.y ?? null,
              source: label.source ?? null,
              dt_ms: labelDt[i],
            }
          : {
              kind: "confirm",
              block_id: label.block_id ?? null,
              x: label.train_x ?? null,
              y: label.train_y ?? null,
              dt_ms: labelDt[i],
            };
    }

    out.write(
      JSON.stringify({
        schema: "glaze.example.v1",
        session_id: sessionId,
        t_ms: g.t_ms,
        source: g.source ?? null,
        gaze: g.filtered ?? null,
        raw: g.raw ?? null,
        confidence: g.confidence ?? null,
        face: !!g.face,
        speed: g.speed ?? null,
        state: g.state ?? null,
        block_id: g.block_id ?? read?.block_id ?? null,
        text_hash: g.text_hash ?? read?.text_hash ?? null,
        line_index: typeof g.line_index === "number" ? g.line_index : (read?.line_index ?? null),
        line_text: lineText,
        line_rect: read?.line_rect ?? null,
        eyes: eye
          ? {
              t_ms: eye.t_ms,
              video_w: eye.video_w ?? null,
              video_h: eye.video_h ?? null,
              left: eye.left ?? null,
              right: eye.right ?? null,
            }
          : null,
        strong: strongLabel,
      }) + "\n",
    );
  }

  await finished(out);

  const duration = gaze.length >= 2 ? gaze[gaze.length - 1].t_ms - gaze[0].t_ms : 0;
  return {
    schema: "glaze.summary.v1",
    duration_ms: duration,
    gaze_samples: gaze.length,
    face_ratio: gaze.length ? face / gaze.length : 0,
    confidence_mean: gaze.length ? confSum / gaze.length : 0,
    state_ms: stateMs,
    reading_rows: reading.length,
    eyes_samples: eyes.length,
    gaze_with_line: withLine,
    line_coverage: gaze.length ? withLine / gaze.length : 0,
    gaze_with_eyes: withEyes,
    strong_events: strong.length,
    strong_label_rows: withStrong,
    example_count: gaze.length,
    camera_bytes: fileBytes(path.join(dir, "camera.webm")),
    voice_bytes: fileBytes(path.join(dir, "voice.webm")),
    dropped_lines:
      gazeFile.dropped + readingFile.dropped + eyesFile.dropped + eventsFile.dropped,
    examples: "examples.jsonl",
  };
}

export async function readJsonl(file) {
  if (!fs.existsSync(file)) return { rows: [], dropped: 0 };
  const rows = [];
  let dropped = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      dropped += 1;
    }
  }
  return { rows, dropped };
}

function nonempty(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function holdIndex(rows, t) {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].t_ms <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function nearestIndex(rows, t) {
  if (!rows.length) return -1;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].t_ms < t) lo = mid + 1;
    else hi = mid;
  }
  const right = lo < rows.length ? lo : -1;
  const left = lo - 1 >= 0 ? lo - 1 : -1;
  if (right < 0) return left;
  if (left < 0) return right;
  return Math.abs(rows[right].t_ms - t) < Math.abs(rows[left].t_ms - t) ? right : left;
}

function nearestWithin(rows, t, windowMs) {
  const index = nearestIndex(rows, t);
  if (index < 0) return null;
  if (Math.abs(rows[index].t_ms - t) > windowMs) return null;
  return rows[index];
}

function fileBytes(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function finished(stream) {
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end();
  });
}
