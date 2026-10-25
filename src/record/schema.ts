/** On-disk session format. Local folders use the same names as a future S3 prefix. */
export const SESSION_SCHEMA = "glaze.session.v1";
export const EXAMPLE_SCHEMA = "glaze.example.v1";

export type GazeSource = "webgazer" | "pointer";
export type VoiceStatus = "live" | "denied" | "unavailable";
export type CameraStatus = "live" | "absent";

export type Box = { x: number; y: number; w: number; h: number };

/** Where the browser window sat on the desktop when this snapshot was taken. */
export type ScreenPlacement = {
  w: number;
  h: number;
  avail_w: number;
  avail_h: number;
  /** Viewport origin, CSS pixels. `window.screenX`. */
  window_x: number;
  /** Viewport origin, CSS pixels. `window.screenY`. */
  window_y: number;
  outer_w: number;
  outer_h: number;
  /** Chrome: left edge of this display on the virtual desktop. Null elsewhere. */
  avail_left: number | null;
  /** Chrome: top edge of this display on the virtual desktop. Null elsewhere. */
  avail_top: number | null;
  /** True when the OS reports more than one display. Null if the browser omits it. */
  is_extended: boolean | null;
  orientation: string | null;
  orientation_angle: number | null;
};

export type EyeLandmarks = {
  video_w: number;
  video_h: number;
  /** Video-pixel points, order fixed by LEFT_EYE_INDICES. */
  left: [number, number][];
  /** Video-pixel points, order fixed by RIGHT_EYE_INDICES. */
  right: [number, number][];
};

export type SessionEventInput =
  | {
      type: "record_start";
      voice: VoiceStatus;
      camera: CameraStatus;
      gaze_source: GazeSource;
    }
  | { type: "record_stop"; fault: string | null }
  | { type: "state"; state: string; reason: string }
  | { type: "teach"; x: number; y: number; source: "shift_click" | "click" }
  | {
      type: "confirm";
      block_id: string | null;
      text_hash: string | null;
      train_x: number | null;
      train_y: number | null;
      index: number;
      total: number;
    }
  | { type: "calibration"; ok: boolean; mean_error_px: number; samples: number }
  | { type: "scroll"; x: number; y: number }
  | { type: "visibility"; state: DocumentVisibilityState }
  | { type: "resize"; w: number; h: number }
  | ({ type: "screen" } & ScreenPlacement);

export type SessionEvent = SessionEventInput & { t_ms: number };

export type JsonlName = "gaze.jsonl" | "reading.jsonl" | "eyes.jsonl" | "events.jsonl";

export function textHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function boxOf(r: { x: number; y: number; w: number; h: number }): Box {
  return { x: round1(r.x), y: round1(r.y), w: round1(r.w), h: round1(r.h) };
}

export function readNumber(value: object, key: string): number | null {
  if (!Object.hasOwn(value, key)) return null;
  const found = Reflect.get(value, key);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

export function readString(value: object, key: string): string | null {
  if (!Object.hasOwn(value, key)) return null;
  const found = Reflect.get(value, key);
  return typeof found === "string" ? found : null;
}

/** Reads a prototype field the DOM lib does not declare, such as `screen.availLeft`. */
export function optionalNumber(value: object, key: string): number | null {
  if (!(key in value)) return null;
  const found = Reflect.get(value, key);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

export function optionalBoolean(value: object, key: string): boolean | null {
  if (!(key in value)) return null;
  const found = Reflect.get(value, key);
  return typeof found === "boolean" ? found : null;
}
