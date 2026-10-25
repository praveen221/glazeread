import webgazer from "webgazer";
import { eyeLandmarks } from "../record/eyeLandmarks";
import type { EyeLandmarks } from "../record/schema";
import { MedianWindow2D, OneEuroFilter2D } from "./oneEuro";
import type { EngineStatus, GazeFrame, Point } from "./types";

export type WebGazerLike = {
  params: {
    faceMeshSolutionPath: string;
    showVideoPreview: boolean;
    applyKalmanFilter: boolean;
    saveDataAcrossSessions: boolean;
    showGazeDot: boolean;
    videoViewerWidth: number;
    videoViewerHeight: number;
    [key: string]: unknown;
  };
  setRegression: (name: string) => WebGazerLike;
  setTracker: (name: string) => WebGazerLike;
  setGazeListener: (fn: (data: { x: number; y: number } | null, elapsed: number) => void) => WebGazerLike;
  clearGazeListener?: () => WebGazerLike;
  begin: () => Promise<WebGazerLike>;
  isReady: () => boolean;
  pause: () => WebGazerLike;
  resume: () => Promise<WebGazerLike> | WebGazerLike;
  end: () => WebGazerLike;
  showVideoPreview: (v: boolean) => WebGazerLike;
  showVideo: (v: boolean) => WebGazerLike;
  showFaceOverlay: (v: boolean) => WebGazerLike;
  showFaceFeedbackBox: (v: boolean) => WebGazerLike;
  showPredictionPoints: (v: boolean) => WebGazerLike;
  saveDataAcrossSessions: (v: boolean) => WebGazerLike;
  applyKalmanFilter: (v: boolean) => WebGazerLike;
  recordScreenPosition: (x: number, y: number, eventType?: string) => WebGazerLike;
  clearData: () => Promise<void> | void;
  getCurrentPrediction: () => { x: number; y: number } | null;
  getTracker?: () => { positionsArray?: number[][] | null };
  addMouseEventListeners: () => WebGazerLike;
  removeMouseEventListeners: () => WebGazerLike;
  setVideoViewerSize?: (w: number, h: number) => WebGazerLike;
};

const wg = webgazer as unknown as WebGazerLike;

/**
 * WebGazer-powered gaze engine (Brown HCI, open source, GPL-3.0).
 * Uses TF.js MediaPipe FaceMesh eye patches + ridge regression + Kalman,
 * then our One Euro filter + confidence / saccade estimates.
 */
export class WebGazerEngine {
  private status: EngineStatus = "idle";
  private onStatus?: (s: EngineStatus, detail?: string) => void;
  private onFrame?: (frame: GazeFrame) => void;
  /** Median spike kill → One Euro (stillness-biased) for reading. */
  private median = new MedianWindow2D(5);
  private filter = new OneEuroFilter2D(0.55, 0.007, 1.0);
  private lastFiltered: Point | null = null;
  private lastStable: Point | null = null;
  private lastFaceAt = 0;
  private started = false;
  private samplesTaught = 0;
  private recentErrors: number[] = [];
  private rafHud = 0;
  private latest: GazeFrame | null = null;

  setStatusHandler(fn: (s: EngineStatus, detail?: string) => void): void {
    this.onStatus = fn;
  }

  setFrameHandler(fn: (frame: GazeFrame) => void): void {
    this.onFrame = fn;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getSamplesTaught(): number {
    return this.samplesTaught;
  }

  private setStatus(s: EngineStatus, detail?: string): void {
    this.status = s;
    this.onStatus?.(s, detail);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.setStatus("loading", "WebGazer + FaceMesh");

    try {
      // Serve local MediaPipe solution from /public/mediapipe/face_mesh
      wg.params.faceMeshSolutionPath = `${window.location.origin}/mediapipe/face_mesh`;
      wg.params.videoViewerWidth = 280;
      wg.params.videoViewerHeight = 210;
      wg.params.showVideoPreview = true;
      wg.params.showVideo = true;
      wg.params.showFaceOverlay = true;
      wg.params.showFaceFeedbackBox = true;
      wg.params.showGazeDot = false;
      wg.params.applyKalmanFilter = true;
      wg.saveDataAcrossSessions(false);

      wg.setRegression("ridge").setTracker("TFFacemesh");

      wg.setGazeListener((data) => {
        const now = performance.now();
        if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
          this.emit({
            raw: null,
            filtered: null,
            confidence: 0,
            faceDetected: now - this.lastFaceAt < 400,
            speed: 0,
          });
          return;
        }

        this.lastFaceAt = now;
        const raw = { x: data.x, y: data.y };
        const denoised = this.median.push(raw.x, raw.y);
        const filtered = this.filter.filter(denoised.x, denoised.y, now);

        let speed = 0;
        if (this.lastFiltered) {
          speed = Math.hypot(
            filtered.x - this.lastFiltered.x,
            filtered.y - this.lastFiltered.y,
          );
        }
        this.lastFiltered = filtered;

        // Freeze output during micro-jitter: only advance "stable" point when
        // movement is meaningful (real saccade / pursuit), not webcam noise.
        if (!this.lastStable || speed > 6) {
          this.lastStable = filtered;
        } else {
          // Blend tiny residual so we don't fully stick forever.
          this.lastStable = {
            x: this.lastStable.x * 0.85 + filtered.x * 0.15,
            y: this.lastStable.y * 0.85 + filtered.y * 0.15,
          };
        }

        const conf = this.estimateConfidence(speed);
        this.emit({
          raw,
          filtered: this.lastStable,
          confidence: conf,
          faceDetected: true,
          speed,
        });

        if (this.status === "ready" || this.status === "loading") {
          this.setStatus("ready");
        } else if (this.samplesTaught >= 20 && this.status !== "calibrating") {
          this.setStatus("tracking");
        }
      });

      // begin() opens the camera, injects DOM, starts the loop, adds click learners.
      await wg.begin();
      this.started = true;

      try {
        wg.showPredictionPoints(false);
        wg.setVideoViewerSize?.(280, 210);
      } catch {
        /* preview chrome is optional */
      }

      this.placeVideoPreview();
      this.setStatus("ready", "camera on — calibrate for accuracy");
      this.rafHud = window.setInterval(() => this.placeVideoPreview(), 800) as unknown as number;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus("error", msg);
      throw err;
    }
  }

  private placeVideoPreview(): void {
    const el = document.getElementById("webgazerVideoContainer");
    const dock = document.getElementById("video-dock");
    if (!el || !dock) return;
    if (el.parentElement !== dock) {
      dock.appendChild(el);
    }
    el.style.position = "relative";
    el.style.top = "0";
    el.style.left = "0";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.margin = "0";
    el.style.transform = "none";
    el.style.zIndex = "1";
  }

  getLatestFrame(): GazeFrame | null {
    if (!this.latest) return null;
    return {
      ...this.latest,
      raw: this.latest.raw ? { ...this.latest.raw } : null,
      filtered: this.latest.filtered ? { ...this.latest.filtered } : null,
    };
  }

  cameraVideo(): HTMLVideoElement | null {
    const el = document.getElementById("webgazerVideoFeed");
    return el instanceof HTMLVideoElement ? el : null;
  }

  /** Eye contour in the webcam frame. Null until FaceMesh has produced a mesh. */
  readEyes(): EyeLandmarks | null {
    const video = this.cameraVideo();
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    const positions = wg.getTracker?.().positionsArray;
    if (!positions || positions.length < 468) return null;
    return eyeLandmarks(positions, video.videoWidth, video.videoHeight);
  }

  private emit(frame: GazeFrame): void {
    this.latest = frame;
    this.onFrame?.(frame);
  }

  private estimateConfidence(speed: number): number {
    // Fast saccades → lower "stable reading" confidence.
    const motion = Math.max(0, 1 - speed / 120);
    const sampleBoost = Math.min(1, this.samplesTaught / 80);
    const recent =
      this.recentErrors.length === 0
        ? 0.55
        : Math.max(
            0,
            1 -
              this.recentErrors.reduce((a, b) => a + b, 0) /
                this.recentErrors.length /
                220,
          );
    return Math.min(1, motion * 0.35 + sampleBoost * 0.35 + recent * 0.3);
  }

  /** Teach the model: user is looking at (x,y). Call during calibration / click-to-correct. */
  teach(screen: Point, bursts = 6): void {
    for (let i = 0; i < bursts; i++) {
      // Slight jitter helps ridge regression generalize.
      const jx = screen.x + (Math.random() - 0.5) * 4;
      const jy = screen.y + (Math.random() - 0.5) * 4;
      wg.recordScreenPosition(jx, jy, "click");
      this.samplesTaught++;
    }
  }

  /** Record residual error for confidence HUD (pixels). */
  noteValidationError(px: number): void {
    this.recentErrors.push(px);
    if (this.recentErrors.length > 12) this.recentErrors.shift();
  }

  async clearCalibration(): Promise<void> {
    this.filter.reset();
    this.median.reset();
    this.samplesTaught = 0;
    this.recentErrors = [];
    this.lastFiltered = null;
    this.lastStable = null;
    await wg.clearData();
  }

  setCalibrating(on: boolean): void {
    if (on) this.setStatus("calibrating");
    else if (this.samplesTaught >= 20) this.setStatus("tracking");
    else this.setStatus("ready");
  }

  getLastFiltered(): Point | null {
    return this.lastFiltered ? { ...this.lastFiltered } : null;
  }

  stop(): void {
    window.clearInterval(this.rafHud);
    try {
      wg.pause();
    } catch {
      /* ignore */
    }
  }
}
