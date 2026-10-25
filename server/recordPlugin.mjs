import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "./joinSession.mjs";

const DATA_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "sessions",
);
const REPO_ROOT = path.resolve(DATA_ROOT, "..", "..");
const JSONL_FILES = new Set(["gaze.jsonl", "reading.jsonl", "eyes.jsonl", "events.jsonl"]);
const STREAMS = new Set(["camera", "voice"]);
const ID_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}_[a-z0-9]{4}$/;

function pad(n) {
  return String(n).padStart(2, "0");
}

function newId(now = new Date()) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_${suffix}`;
}

function sessionDir(id) {
  if (!ID_RE.test(id)) throw new Error("bad session id");
  const dir = path.resolve(DATA_ROOT, id);
  if (dir !== DATA_ROOT && !dir.startsWith(DATA_ROOT + path.sep)) throw new Error("bad session path");
  return dir;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(json);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function pickString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function glazeRecordPlugin() {
  const live = new Map();

  function stateFor(id) {
    let state = live.get(id);
    if (!state) {
      state = { queue: Promise.resolve(), lastSeq: { camera: -1, voice: -1 } };
      live.set(id, state);
    }
    return state;
  }

  function enqueue(id, job) {
    const state = stateFor(id);
    const run = state.queue.then(job, job);
    state.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "__glaze") {
      send(res, 404, { ok: false, error: "not found" });
      return;
    }

    if (req.method === "GET" && parts.length === 2 && parts[1] === "sessions") {
      const indexPath = path.join(DATA_ROOT, "index.jsonl");
      const sessions = [];
      if (fs.existsSync(indexPath)) {
        const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter(Boolean).slice(-20);
        for (const line of lines) {
          try {
            sessions.push(JSON.parse(line));
          } catch {
            /* skip a torn line */
          }
        }
      }
      send(res, 200, { ok: true, sessions });
      return;
    }

    if (req.method === "POST" && parts.length === 2 && parts[1] === "session") {
      const raw = await readBody(req, 256_000);
      let meta = {};
      if (raw.length) {
        try {
          meta = JSON.parse(raw.toString("utf8"));
        } catch {
          send(res, 400, { ok: false, error: "bad json" });
          return;
        }
      }
      if (!asObject(meta)) {
        send(res, 400, { ok: false, error: "bad meta" });
        return;
      }
      const now = new Date();
      const id = newId(now);
      const dir = sessionDir(id);
      await fs.promises.mkdir(dir, { recursive: true });
      const y = String(now.getFullYear());
      const m = pad(now.getMonth() + 1);
      const d = pad(now.getDate());
      const voice =
        meta.voice === "denied" || meta.voice === "unavailable" ? meta.voice : "live";
      const camera = meta.camera === "absent" ? "absent" : "live";
      const manifest = {
        schema: "glaze.session.v1",
        session_id: id,
        status: "open",
        started_wall: now.toISOString(),
        ended_wall: null,
        timezone: pickString(meta.timezone, ""),
        t0_wall_ms: typeof meta.t0_wall_ms === "number" ? meta.t0_wall_ms : now.getTime(),
        ua: pickString(meta.ua),
        url: pickString(meta.url),
        viewport: asObject(meta.viewport),
        screen: asObject(meta.screen),
        gaze_source: meta.gaze_source === "pointer" ? "pointer" : "webgazer",
        voice,
        camera,
        camera_mime: pickString(meta.camera_mime),
        voice_mime: pickString(meta.voice_mime),
        camera_track: asObject(meta.camera_track),
        voice_track: asObject(meta.voice_track),
        storage: {
          backend: "local",
          dir: path.relative(REPO_ROOT, dir),
          s3_key_prefix: `raw/v1/${y}/${m}/${d}/${id}/`,
        },
        files: [
          "manifest.json",
          "content.json",
          "gaze.jsonl",
          "reading.jsonl",
          "eyes.jsonl",
          "events.jsonl",
          "media.jsonl",
          "camera.webm",
          "voice.webm",
        ],
        clock: {
          t_ms: "performance.now() at the sample, minus performance.now() when Record was pressed",
          wall_ms: "t0_wall_ms + t_ms",
          media:
            "camera.webm and voice.webm start at the first chunk. That chunk's t_ms in media.jsonl is the offset from t0.",
        },
        summary: null,
        fault: null,
      };
      await fs.promises.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
      stateFor(id);
      send(res, 200, {
        ok: true,
        session_id: id,
        dir: manifest.storage.dir,
        s3_key_prefix: manifest.storage.s3_key_prefix,
      });
      return;
    }

    if (parts[1] !== "session" || !parts[2]) {
      send(res, 404, { ok: false, error: "not found" });
      return;
    }

    let dir;
    try {
      dir = sessionDir(parts[2]);
    } catch (err) {
      send(res, 400, { ok: false, error: err instanceof Error ? err.message : "bad id" });
      return;
    }
    if (!fs.existsSync(dir)) {
      send(res, 404, { ok: false, error: "no session" });
      return;
    }

    const id = parts[2];
    const action = parts[3];

    if (req.method === "POST" && action === "append") {
      const file = url.searchParams.get("file") ?? "";
      if (!JSONL_FILES.has(file)) {
        send(res, 400, { ok: false, error: "bad file" });
        return;
      }
      const raw = await readBody(req, 2_000_000);
      let text = raw.toString("utf8");
      if (!text.length) {
        send(res, 200, { ok: true, bytes: 0 });
        return;
      }
      if (!text.endsWith("\n")) text += "\n";
      await enqueue(id, () => fs.promises.appendFile(path.join(dir, file), text));
      send(res, 200, { ok: true, bytes: Buffer.byteLength(text) });
      return;
    }

    if (req.method === "POST" && action === "content") {
      const raw = await readBody(req, 4_000_000);
      try {
        JSON.parse(raw.toString("utf8"));
      } catch {
        send(res, 400, { ok: false, error: "bad json" });
        return;
      }
      await enqueue(id, () => fs.promises.writeFile(path.join(dir, "content.json"), raw));
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && action === "chunk") {
      const stream = url.searchParams.get("stream") ?? "";
      const seq = Number(url.searchParams.get("seq"));
      const tMs = Number(url.searchParams.get("t_ms"));
      if (!STREAMS.has(stream) || !Number.isInteger(seq) || seq < 0 || !Number.isFinite(tMs)) {
        send(res, 400, { ok: false, error: "bad chunk" });
        return;
      }
      const raw = await readBody(req, 12_000_000);
      const result = await enqueue(id, async () => {
        const state = stateFor(id);
        if (seq <= state.lastSeq[stream]) return { duplicate: true, bytes: raw.length };
        const gap = seq !== state.lastSeq[stream] + 1;
        await fs.promises.appendFile(path.join(dir, `${stream}.webm`), raw);
        state.lastSeq[stream] = seq;
        const line = JSON.stringify({ stream, seq, t_ms: tMs, bytes: raw.length, gap }) + "\n";
        await fs.promises.appendFile(path.join(dir, "media.jsonl"), line);
        return { duplicate: false, bytes: raw.length, gap };
      });
      send(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "POST" && action === "finish") {
      const raw = await readBody(req, 64_000);
      let extra = {};
      if (raw.length) {
        try {
          extra = JSON.parse(raw.toString("utf8"));
        } catch {
          send(res, 400, { ok: false, error: "bad json" });
          return;
        }
      }
      const summary = await enqueue(id, async () => {
        const manifestPath = path.join(dir, "manifest.json");
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
        let joined = null;
        let joinError = null;
        try {
          joined = await joinSession(dir);
        } catch (err) {
          joinError = err instanceof Error ? err.message : String(err);
        }
        manifest.status = "closed";
        manifest.ended_wall = new Date().toISOString();
        manifest.fault = extra && typeof extra.fault === "string" ? extra.fault : null;
        manifest.summary = joined ?? { error: joinError };
        if (joined && joinError) manifest.summary.join_error = joinError;
        if (!manifest.files.includes("examples.jsonl")) manifest.files.push("examples.jsonl");
        await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        const indexRow = {
          session_id: manifest.session_id,
          started_wall: manifest.started_wall,
          ended_wall: manifest.ended_wall,
          dir: manifest.storage?.dir ?? null,
          s3_key_prefix: manifest.storage?.s3_key_prefix ?? null,
          fault: manifest.fault,
          summary: manifest.summary,
        };
        await fs.promises.mkdir(DATA_ROOT, { recursive: true });
        await fs.promises.appendFile(
          path.join(DATA_ROOT, "index.jsonl"),
          JSON.stringify(indexRow) + "\n",
        );
        return manifest.summary;
      });
      live.delete(id);
      send(res, 200, { ok: true, summary });
      return;
    }

    send(res, 404, { ok: false, error: "not found" });
  }

  return {
    name: "glaze-record",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? "").startsWith("/__glaze/")) {
          next();
          return;
        }
        handle(req, res).catch((err) => {
          if (res.writableEnded) return;
          send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        });
      });
    },
  };
}
