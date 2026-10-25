import { SESSION_SCHEMA, type JsonlName, type ScreenPlacement } from "./schema";

export type OpenSessionMeta = {
  schema: typeof SESSION_SCHEMA;
  t0_wall_ms: number;
  timezone: string;
  ua: string;
  url: string;
  viewport: { w: number; h: number; dpr: number };
  screen: ScreenPlacement;
  gaze_source: "webgazer" | "pointer";
  voice: "live" | "denied" | "unavailable";
  camera: "live" | "absent";
  camera_mime: string;
  voice_mime: string;
  camera_track: Record<string, string | number | boolean> | null;
  voice_track: Record<string, string | number | boolean> | null;
};

export type OpenSessionResult = {
  session_id: string;
  dir: string;
  s3_key_prefix: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!isRecord(body)) throw new Error(`save failed (${res.status})`);
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `save failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

export async function openSession(meta: OpenSessionMeta): Promise<OpenSessionResult> {
  const res = await fetch("/__glaze/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(meta),
  });
  const body = await readResponse(res);
  if (
    typeof body.session_id !== "string" ||
    typeof body.dir !== "string" ||
    typeof body.s3_key_prefix !== "string"
  ) {
    throw new Error("bad session response");
  }
  return {
    session_id: body.session_id,
    dir: body.dir,
    s3_key_prefix: body.s3_key_prefix,
  };
}

export async function appendJsonl(sessionId: string, file: JsonlName, ndjson: string): Promise<void> {
  const res = await fetch(
    `/__glaze/session/${sessionId}/append?file=${encodeURIComponent(file)}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body: ndjson.endsWith("\n") ? ndjson : `${ndjson}\n`,
    },
  );
  await readResponse(res);
}

export async function writeContent(sessionId: string, content: unknown): Promise<void> {
  const res = await fetch(`/__glaze/session/${sessionId}/content`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(content),
  });
  await readResponse(res);
}

export async function postChunk(
  sessionId: string,
  stream: "camera" | "voice",
  seq: number,
  tMs: number,
  data: Blob,
): Promise<void> {
  const res = await fetch(
    `/__glaze/session/${sessionId}/chunk?stream=${stream}&seq=${seq}&t_ms=${Math.round(tMs)}`,
    {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: data,
    },
  );
  await readResponse(res);
}

export async function finishSession(sessionId: string, fault: string | null): Promise<unknown> {
  const res = await fetch(`/__glaze/session/${sessionId}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fault }),
    keepalive: true,
  });
  const body = await readResponse(res);
  return body.summary ?? null;
}
