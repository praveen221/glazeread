import type { GazeFrame } from "../gaze/types";
import { lineAtPoint } from "../reading/geometry";
import type { AttentionSnapshot, BlockView } from "../overlay/reading";
import {
  SESSION_SCHEMA,
  boxOf,
  optionalBoolean,
  optionalNumber,
  round1,
  textHash,
  type CameraStatus,
  type EyeLandmarks,
  type GazeSource,
  type JsonlName,
  type ScreenPlacement,
  type SessionEventInput,
  type VoiceStatus,
} from "./schema";
import {
  appendJsonl,
  finishSession,
  openSession,
  postChunk,
  writeContent,
  type OpenSessionMeta,
} from "./ingest";

export class RecordingCancelled extends Error {
  constructor() {
    super("Recording cancelled");
    this.name = "RecordingCancelled";
  }
}

export type RecorderPhase = "idle" | "starting" | "recording" | "stopping";

export type RecorderView = {
  phase: RecorderPhase;
  sessionId: string;
  dir: string;
  elapsedMs: number;
  fault: string | null;
  voice: VoiceStatus | "off";
  camera: CameraStatus | "off";
};

export type StoppedSession = {
  sessionId: string;
  dir: string;
  summary: unknown;
  fault: string | null;
};

export type RecordHooks = {
  ensureCamera: () => Promise<void>;
  gazeSource: () => GazeSource;
  videoEl: () => HTMLVideoElement | null;
  readEyes: () => EyeLandmarks | null;
  attention: () => AttentionSnapshot;
  blocks: (withText: boolean) => BlockView[];
  blockElement: (id: string) => HTMLElement | null;
};

type Batch = { file: JsonlName; body: string };

/**
 * One morning take. Record is explicit. Camera, mic, gaze, eye landmarks,
 * and the line under the eyes share one session clock and land in data/sessions.
 */
export class SessionRecorder {
  private phase: RecorderPhase = "idle";
  private hooks: RecordHooks | null = null;
  private sessionId = "";
  private dir = "";
  private t0 = 0;
  private wall0 = 0;
  private fault: string | null = null;
  private voice: VoiceStatus | "off" = "off";
  private camera: CameraStatus | "off" = "off";
  private micStream: MediaStream | null = null;
  private cameraRec: MediaRecorder | null = null;
  private voiceRec: MediaRecorder | null = null;
  private seq = { camera: 0, voice: 0 };
  private pump: Promise<void> = Promise.resolve();
  private gazeBuf: object[] = [];
  private readingBuf: object[] = [];
  private eyesBuf: object[] = [];
  private eventBuf: object[] = [];
  private timer = 0;
  private ticks = 0;
  private lastState = "";
  private lastTickState = "";
  private lastBlock: string | null = null;
  private lastLine: number | null = null;
  private lastEyeAt = -1000;
  private lastViewportAt = -1000;
  private lastScrollAt = -1000;
  private lastScreen = "";
  private onScroll: (() => void) | null = null;
  private onResize: (() => void) | null = null;
  private onVis: (() => void) | null = null;
  private onChange: ((view: RecorderView) => void) | null = null;
  private cancelRequested = false;

  setChangeHandler(fn: (view: RecorderView) => void): void {
    this.onChange = fn;
  }

  view(): RecorderView {
    const running = this.phase === "recording" || this.phase === "stopping";
    return {
      phase: this.phase,
      sessionId: this.sessionId,
      dir: this.dir,
      elapsedMs: running ? this.now() : 0,
      fault: this.fault,
      voice: this.voice,
      camera: this.camera,
    };
  }

  isRecording(): boolean {
    return this.phase === "recording" || this.phase === "starting";
  }

  async start(hooks: RecordHooks): Promise<void> {
    if (this.phase !== "idle") return;
    this.phase = "starting";
    this.cancelRequested = false;
    this.hooks = hooks;
    this.fault = null;
    this.t0 = performance.now();
    this.wall0 = Date.now();
    this.voice = "off";
    this.camera = "off";
    this.emit();

    let mic: MediaStream | null = null;
    try {
      await hooks.ensureCamera();
      this.throwIfCancelled();
      const micResult = await openMic();
      mic = micResult.stream;
      this.throwIfCancelled(mic);
      this.voice = micResult.status;

      const source = hooks.gazeSource();
      const video = source === "pointer" ? null : await this.waitForVideo();
      this.throwIfCancelled(mic);
      const cameraStream = video ? captureVideo(video, 15) : null;
      const cameraLive = !!cameraStream && cameraStream.getVideoTracks().length > 0;
      this.camera = cameraLive ? "live" : "absent";

      const cameraMime = cameraLive && cameraStream
        ? pickMime(["video/webm;codecs=vp8", "video/webm"])
        : "";
      const voiceMime = mic
        ? pickMime(["audio/webm;codecs=opus", "audio/webm"])
        : "";

      const opened = await openSession(
        sessionMeta({
          wall0: this.wall0,
          gazeSource: source,
          voice: this.voice,
          camera: this.camera,
          cameraMime,
          voiceMime,
          video,
          mic,
        }),
      );
      this.sessionId = opened.session_id;
      this.dir = opened.dir;
      this.micStream = mic;
      this.phase = "recording";

      await this.writeArticle();
      if (cameraLive && cameraStream) {
        this.cameraRec = this.bindRecorder(cameraStream, "camera", cameraMime, video);
      }
      if (mic) {
        this.voiceRec = this.bindRecorder(mic, "voice", voiceMime, null);
      }
      this.note({
        type: "record_start",
        voice: this.voice,
        camera: this.camera,
        gaze_source: source,
      });
      this.arm();
      this.sampleReading();
      this.emit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.disarm();
      if (this.cameraRec && this.cameraRec.state !== "inactive") this.cameraRec.stop();
      if (this.voiceRec && this.voiceRec.state !== "inactive") this.voiceRec.stop();
      this.cameraRec = null;
      this.voiceRec = null;
      mic?.getTracks().forEach((track) => track.stop());
      this.releaseMic();
      const orphan = this.sessionId;
      this.fault = message;
      this.reset();
      this.emit();
      if (orphan) {
        try {
          await finishSession(orphan, message);
        } catch {
          /* the open folder stays on disk with status open */
        }
      }
      throw err;
    }
  }

  observe(frame: GazeFrame, source: GazeSource): void {
    if (this.phase !== "recording" || !this.hooks) return;
    const attention = this.hooks.attention();
    if (attention.state !== this.lastState) {
      this.lastState = attention.state;
      this.note({ type: "state", state: attention.state, reason: attention.reason });
    }
    const t = Math.round(this.now());
    const looked = lineUnder(this.hooks, attention, frame.filtered);
    this.gazeBuf.push({
      t_ms: t,
      raw: frame.raw ? { x: round1(frame.raw.x), y: round1(frame.raw.y) } : null,
      filtered: frame.filtered ? { x: round1(frame.filtered.x), y: round1(frame.filtered.y) } : null,
      confidence: round1(frame.confidence),
      face: frame.faceDetected,
      speed: round1(frame.speed),
      state: attention.state,
      source,
      block_id: looked?.blockId ?? null,
      text_hash: looked?.textHash ?? null,
      line_index: looked?.index ?? null,
      line_text: looked?.text ?? null,
    });
    if (source === "webgazer" && t - this.lastEyeAt >= 100) {
      const eyes = this.hooks.readEyes();
      if (eyes) {
        this.lastEyeAt = t;
        this.eyesBuf.push({ t_ms: t, ...eyes });
      }
    }
    if (this.gazeBuf.length >= 180) this.enqueueFlush();
  }

  note(event: SessionEventInput): void {
    if (this.phase !== "recording" && this.phase !== "stopping") return;
    this.eventBuf.push({ ...event, t_ms: Math.round(this.now()) });
  }

  async stop(): Promise<StoppedSession | null> {
    if (this.phase === "starting") {
      this.cancelRequested = true;
      return null;
    }
    if (this.phase !== "recording") return null;
    this.phase = "stopping";
    this.emit();
    this.disarm();
    await this.finishRecorder(this.cameraRec);
    await this.finishRecorder(this.voiceRec);
    this.cameraRec = null;
    this.voiceRec = null;
    this.releaseMic();
    await new Promise((resolve) => setTimeout(resolve, 80));
    this.note({ type: "record_stop", fault: this.fault });
    const sessionId = this.sessionId;
    const dir = this.dir;
    const fault = this.fault;
    try {
      this.enqueueFlush();
      await this.pump;
      const summary = await finishSession(sessionId, fault);
      this.reset();
      this.emit();
      return { sessionId, dir, summary, fault };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fault = message;
      this.reset();
      this.emit();
      throw err;
    }
  }

  private async writeArticle(): Promise<void> {
    if (!this.hooks || !this.sessionId) return;
    const blocks = this.hooks.blocks(true).map((block) => ({
      id: block.id,
      tag: block.tag,
      text: block.text,
      text_hash: textHash(block.text),
    }));
    await writeContent(this.sessionId, { schema: SESSION_SCHEMA, blocks });
  }

  private sampleReading(): void {
    if (this.phase !== "recording" || !this.hooks) return;
    const attention = this.hooks.attention();
    const t = Math.round(this.now());
    let lineIndex: number | null = null;
    let lineCount: number | null = null;
    let lineText: string | null = null;
    let lineRect: ReturnType<typeof boxOf> | null = null;
    if (attention.block && attention.gaze) {
      const el = this.hooks.blockElement(attention.block.id);
      const line = el ? lineAtPoint(el, attention.gaze.y) : null;
      if (line) {
        lineIndex = line.index;
        lineCount = line.count;
        lineText = line.text;
        lineRect = boxOf(line.rect);
      }
    }
    const changed =
      attention.state !== this.lastTickState ||
      (attention.block?.id ?? null) !== this.lastBlock ||
      lineIndex !== this.lastLine;
    this.lastTickState = attention.state;
    this.lastBlock = attention.block?.id ?? null;
    this.lastLine = lineIndex;
    const viewport = {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    };
    this.readingBuf.push({
      t_ms: t,
      kind: changed ? "focus" : "tick",
      state: attention.state,
      freeze: attention.freeze,
      block_id: attention.block?.id ?? null,
      focus_id: attention.focusId,
      text_hash: attention.block ? textHash(attention.block.text) : null,
      rect: attention.block ? boxOf(attention.block.rect) : null,
      line_index: lineIndex,
      line_count: lineCount,
      line_text: lineText,
      line_rect: lineRect,
      gaze: attention.gaze ? { x: round1(attention.gaze.x), y: round1(attention.gaze.y) } : null,
      confidence: round1(attention.confidence),
      scroll_x: round1(window.scrollX),
      scroll_y: round1(window.scrollY),
      viewport,
    });
    if (t - this.lastViewportAt >= 1000) {
      this.lastViewportAt = t;
      const visible = this.hooks
        .blocks(false)
        .filter((block) => intersectsViewport(block.rect))
        .map((block) => ({
          id: block.id,
          x: round1(block.rect.x),
          y: round1(block.rect.y),
          w: round1(block.rect.w),
          h: round1(block.rect.h),
          done: block.done,
        }));
      this.readingBuf.push({
        t_ms: t,
        kind: "viewport",
        scroll_x: round1(window.scrollX),
        scroll_y: round1(window.scrollY),
        viewport,
        visible,
      });
    }
  }

  private bindRecorder(
    stream: MediaStream,
    name: "camera" | "voice",
    mime: string,
    video: HTMLVideoElement | null,
  ): MediaRecorder {
    const options: MediaRecorderOptions = {};
    if (mime) options.mimeType = mime;
    if (name === "camera" && video) options.videoBitsPerSecond = cameraBits(video);
    if (name === "voice") options.audioBitsPerSecond = 32_000;
    const recorder = new MediaRecorder(stream, options);
    recorder.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0 || !this.sessionId) return;
      const seq = this.seq[name];
      this.seq[name] += 1;
      const tMs = this.now();
      const blob = ev.data;
      const sessionId = this.sessionId;
      this.enqueue(async () => {
        await postChunk(sessionId, name, seq, tMs, blob);
      });
    };
    recorder.start(1000);
    return recorder;
  }

  private arm(): void {
    this.onScroll = () => {
      const t = this.now();
      if (t - this.lastScrollAt < 200) return;
      this.lastScrollAt = t;
      this.note({ type: "scroll", x: round1(window.scrollX), y: round1(window.scrollY) });
    };
    this.onResize = () => {
      this.note({ type: "resize", w: window.innerWidth, h: window.innerHeight });
      this.noteScreen(false);
    };
    this.onVis = () => {
      this.note({ type: "visibility", state: document.visibilityState });
    };
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVis);
    this.noteScreen(true);
    this.timer = window.setInterval(() => {
      this.ticks += 1;
      this.sampleReading();
      if (this.ticks % 4 === 0) {
        this.noteScreen(false);
        this.enqueueFlush();
      }
      this.emit();
    }, 250);
  }

  private noteScreen(force: boolean): void {
    const placement = screenPlacement();
    const key = JSON.stringify(placement);
    if (!force && key === this.lastScreen) return;
    this.lastScreen = key;
    this.note({ type: "screen", ...placement });
  }

  private disarm(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    if (this.onScroll) window.removeEventListener("scroll", this.onScroll);
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    if (this.onVis) document.removeEventListener("visibilitychange", this.onVis);
    this.onScroll = null;
    this.onResize = null;
    this.onVis = null;
  }

  private enqueueFlush(): void {
    const batches = this.takeBatches();
    if (!batches.length || !this.sessionId) return;
    const sessionId = this.sessionId;
    this.enqueue(async () => {
      for (const batch of batches) {
        await appendJsonl(sessionId, batch.file, batch.body);
      }
    });
  }

  private takeBatches(): Batch[] {
    const batches: Batch[] = [];
    const pull = (file: JsonlName, buf: object[]) => {
      if (!buf.length) return;
      const body = buf.map((row) => JSON.stringify(row)).join("\n");
      buf.length = 0;
      batches.push({ file, body });
    };
    pull("gaze.jsonl", this.gazeBuf);
    pull("reading.jsonl", this.readingBuf);
    pull("eyes.jsonl", this.eyesBuf);
    pull("events.jsonl", this.eventBuf);
    return batches;
  }

  private enqueue(task: () => Promise<void>): void {
    this.pump = this.pump.then(async () => {
      let last: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await task();
          return;
        } catch (err) {
          last = err;
          await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
        }
      }
      this.markFault(last);
    });
  }

  private markFault(err: unknown): void {
    if (this.fault) return;
    this.fault = err instanceof Error ? err.message : String(err);
    this.emit();
    if (this.phase !== "recording") return;
    queueMicrotask(() => {
      if (this.phase === "recording") void this.stop();
    });
  }

  private async finishRecorder(recorder: MediaRecorder | null): Promise<void> {
    if (!recorder || recorder.state === "inactive") return;
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }

  private releaseMic(): void {
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
  }

  private async waitForVideo(): Promise<HTMLVideoElement | null> {
    const deadline = performance.now() + 2500;
    while (performance.now() < deadline) {
      const video = this.hooks?.videoEl() ?? null;
      if (video && video.videoWidth > 0 && video.readyState >= 2) return video;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.hooks?.videoEl() ?? null;
  }

  private now(): number {
    return performance.now() - this.t0;
  }

  private reset(): void {
    this.phase = "idle";
    this.hooks = null;
    this.sessionId = "";
    this.voice = "off";
    this.camera = "off";
    this.seq = { camera: 0, voice: 0 };
    this.gazeBuf = [];
    this.readingBuf = [];
    this.eyesBuf = [];
    this.eventBuf = [];
    this.ticks = 0;
    this.lastState = "";
    this.lastTickState = "";
    this.lastBlock = null;
    this.lastLine = null;
    this.lastEyeAt = -1000;
    this.lastViewportAt = -1000;
    this.lastScrollAt = -1000;
    this.lastScreen = "";
    this.cancelRequested = false;
  }

  private throwIfCancelled(mic: MediaStream | null = null): void {
    if (!this.cancelRequested) return;
    mic?.getTracks().forEach((track) => track.stop());
    throw new RecordingCancelled();
  }

  private emit(): void {
    this.onChange?.(this.view());
  }
}

function lineUnder(
  hooks: RecordHooks,
  attention: AttentionSnapshot,
  gaze: { x: number; y: number } | null,
): { blockId: string; textHash: string; index: number | null; text: string | null } | null {
  if (!attention.block) return null;
  const el = hooks.blockElement(attention.block.id);
  const line = el && gaze ? lineAtPoint(el, gaze.y) : null;
  return {
    blockId: attention.block.id,
    textHash: textHash(attention.block.text),
    index: line ? line.index : null,
    text: line && line.text ? line.text : null,
  };
}

function openMic(): Promise<{ stream: MediaStream | null; status: VoiceStatus }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.resolve({ stream: null, status: "unavailable" });
  }
  return navigator.mediaDevices
    .getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      video: false,
    })
    .then((stream) => ({ stream, status: "live" as const }))
    .catch(() => ({ stream: null, status: "denied" as const }));
}

function captureVideo(video: HTMLVideoElement, fps: number): MediaStream | null {
  if (!("captureStream" in video)) return null;
  const method = Reflect.get(video, "captureStream");
  if (typeof method !== "function") return null;
  try {
    const stream = Reflect.apply(method, video, [fps]);
    return stream instanceof MediaStream ? stream : null;
  } catch {
    return null;
  }
}

function pickMime(candidates: string[]): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function cameraBits(video: HTMLVideoElement): number {
  const pixels = video.videoWidth * video.videoHeight;
  if (pixels >= 1280 * 720) return 1_400_000;
  if (pixels >= 640 * 480) return 800_000;
  return 400_000;
}

function screenPlacement(): ScreenPlacement {
  const display = window.screen;
  const orientation = display.orientation;
  const angle = orientation?.angle;
  return {
    w: display.width,
    h: display.height,
    avail_w: display.availWidth,
    avail_h: display.availHeight,
    window_x: round1(window.screenX),
    window_y: round1(window.screenY),
    outer_w: window.outerWidth,
    outer_h: window.outerHeight,
    avail_left: roundedOptional(optionalNumber(display, "availLeft")),
    avail_top: roundedOptional(optionalNumber(display, "availTop")),
    is_extended: optionalBoolean(display, "isExtended"),
    orientation: orientation && typeof orientation.type === "string" ? orientation.type : null,
    orientation_angle: typeof angle === "number" && Number.isFinite(angle) ? angle : null,
  };
}

function roundedOptional(value: number | null): number | null {
  return value === null ? null : round1(value);
}

function intersectsViewport(rect: { x: number; y: number; w: number; h: number }): boolean {
  return (
    rect.h > 0 &&
    rect.w > 0 &&
    rect.y < window.innerHeight &&
    rect.y + rect.h > 0 &&
    rect.x < window.innerWidth &&
    rect.x + rect.w > 0
  );
}

function trackSettings(track: MediaStreamTrack | undefined): Record<string, string | number | boolean> | null {
  if (!track) return null;
  const settings = track.getSettings();
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  if (track.label) out.label = track.label;
  return out;
}

function sessionMeta(input: {
  wall0: number;
  gazeSource: GazeSource;
  voice: VoiceStatus;
  camera: CameraStatus;
  cameraMime: string;
  voiceMime: string;
  video: HTMLVideoElement | null;
  mic: MediaStream | null;
}): OpenSessionMeta {
  return {
    schema: SESSION_SCHEMA,
    t0_wall_ms: input.wall0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    ua: navigator.userAgent,
    url: location.href,
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
    screen: screenPlacement(),
    gaze_source: input.gazeSource,
    voice: input.voice,
    camera: input.camera,
    camera_mime: input.cameraMime,
    voice_mime: input.voiceMime,
    camera_track: input.video?.srcObject instanceof MediaStream
      ? trackSettings(input.video.srcObject.getVideoTracks()[0])
      : null,
    voice_track: trackSettings(input.mic?.getAudioTracks()[0]),
  };
}
