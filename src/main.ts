import { runCalibration } from "./gaze/calibration";
import type { EngineStatus } from "./gaze/types";
import { WebGazerEngine } from "./gaze/webgazerEngine";
import { ReadingOverlay } from "./overlay/reading";
import { readNumber, textHash } from "./record/schema";
import { RecordingCancelled, SessionRecorder, type RecorderView } from "./record/sessionRecorder";
import { loadReading } from "./ui/loadText";
import { sampleArticleHtml } from "./ui/sampleArticle";
import "./style.css";

function statusLabel(s: EngineStatus): string {
  switch (s) {
    case "idle":
      return "Idle";
    case "loading":
      return "Loading WebGazer…";
    case "needs-permission":
      return "Camera permission needed";
    case "ready":
      return "Ready — run calibration";
    case "calibrating":
      return "Calibrating";
    case "tracking":
      return "Tracking (WebGazer · local)";
    case "error":
      return "Error";
  }
}

function statusClass(s: EngineStatus): string {
  if (s === "tracking") return "ok";
  if (s === "error") return "err";
  if (s === "loading" || s === "ready" || s === "calibrating") return "warn";
  return "";
}

function toast(msg: string): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 3200);
}

function mount(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  app.innerHTML = `
    <div class="app-shell">
      <main class="reader">
        <div class="reader-inner" id="reader-root">
          ${sampleArticleHtml}
        </div>
      </main>
      <aside class="side-panel">
        <div class="brand">
          <strong>Glaze</strong>
          <span>Gaze-guided reading</span>
        </div>
        <div class="load-box">
          <label for="load-text">Text you will read</label>
          <textarea id="load-text" rows="6" placeholder="Paste tonight's reading. A blank line starts a new paragraph. A line that starts with # is a heading."></textarea>
          <button type="button" id="btn-load">Use this text</button>
          <p class="load-note" id="load-note">Showing the sample article. Replace it before Record, or the hour is labeled as that article.</p>
        </div>
        <div class="record-box">
          <button type="button" class="record" id="btn-record">Record</button>
          <p class="rec-status" id="rec-status">Off. Record writes the camera, microphone, gaze, and the line you were on to this machine.</p>
        </div>
        <div class="engine-pill">WebGazer · on-device</div>

        <div class="video-dock" id="video-dock">
          <div class="video-badge" id="video-badge">Preview · this machine</div>
        </div>

        <div class="status-row">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">Start the camera to begin</span>
        </div>

        <div class="metric">
          <div class="card">
            <small>Train samples</small>
            <strong id="metric-samples">0</strong>
          </div>
          <div class="card">
            <small>Calib error</small>
            <strong id="metric-error">—</strong>
          </div>
          <div class="card">
            <small>Reading state</small>
            <strong id="metric-state">Away</strong>
          </div>
          <div class="card">
            <small>Paras done</small>
            <strong id="metric-done">0</strong>
          </div>
        </div>

        <div class="actions">
          <button type="button" class="primary" id="btn-camera">Start camera</button>
          <button type="button" id="btn-calibrate" disabled>Full calibrate</button>
          <button type="button" class="ghost" id="btn-recal" disabled>Recalibrate</button>
        </div>

        <div class="toggle">
          <span>Glaze active</span>
          <input type="checkbox" id="tog-enabled" checked />
        </div>
        <div class="toggle">
          <span>Spotlight mode</span>
          <input type="checkbox" id="tog-spot" checked />
        </div>
        <div class="toggle">
          <span>Gaze trail</span>
          <input type="checkbox" id="tog-trail" checked />
        </div>
        <div class="toggle">
          <span>Show gaze dot</span>
          <input type="checkbox" id="tog-dot" checked />
        </div>
        <div class="toggle">
          <span>Pointer mode (no camera)</span>
          <input type="checkbox" id="tog-pointer" />
        </div>
        <div class="toggle">
          <span>Click-to-correct learn</span>
          <input type="checkbox" id="tog-learn" checked />
        </div>

        <div class="field">
          <label>
            <span>Zoom</span>
            <span id="zoom-val">1.10×</span>
          </label>
          <input type="range" id="rng-zoom" min="1.03" max="1.22" step="0.01" value="1.10" />
        </div>

        <div class="field">
          <label><span>Guide color</span></label>
          <input type="color" id="clr-guide" value="#34d399" />
        </div>

        <p class="hint">
          <strong>Read mode:</strong> state chip shows Reading / Searching / Away /
          Hesitating. Away freezes zoom so phone glances don’t thrash the page.
          Paste your text, press Record, then Full calibrate, then read in this window.
          Press <kbd>Space</kbd> when you finish a paragraph.
          <kbd>R</kbd> record · <kbd>G</kbd> toggle · <kbd>C</kbd> recalibrate · <kbd>Shift</kbd>+click when the dot is on the wrong line.
        </p>

        <div class="privacy">
          Gaze stack: <strong>WebGazer.js</strong> (Brown HCI, open source) —
          MediaPipe FaceMesh eye patches + ridge regression + Kalman, then One Euro
          smoothing. Frames stay in this tab until you press Record. A take is written
          only under <strong>data/sessions</strong> on this machine. WebGazer is GPL-3.0; the UI is MIT.
        </div>
      </aside>
    </div>

    <div class="cal-overlay" id="cal-overlay" aria-hidden="true">
      <div class="cal-ring" id="cal-ring"></div>
      <div class="cal-target" id="cal-target"></div>
      <div class="cal-copy">
        <h2 id="cal-title">Calibration</h2>
        <p id="cal-msg">Look at the green target until it moves.</p>
      </div>
    </div>
    <div class="toast" id="toast"></div>
    <div class="rec-pill" id="rec-pill" hidden>Recording · local</div>
  `;

  const readerRoot = document.querySelector<HTMLElement>("#reader-root")!;
  const statusDot = document.querySelector<HTMLElement>("#status-dot")!;
  const statusText = document.querySelector<HTMLElement>("#status-text")!;
  const btnCamera = document.querySelector<HTMLButtonElement>("#btn-camera")!;
  const btnCalibrate = document.querySelector<HTMLButtonElement>("#btn-calibrate")!;
  const btnRecal = document.querySelector<HTMLButtonElement>("#btn-recal")!;
  const metricSamples = document.querySelector<HTMLElement>("#metric-samples")!;
  const metricError = document.querySelector<HTMLElement>("#metric-error")!;
  const metricState = document.querySelector<HTMLElement>("#metric-state")!;
  const metricDone = document.querySelector<HTMLElement>("#metric-done")!;
  const togEnabled = document.querySelector<HTMLInputElement>("#tog-enabled")!;
  const togSpot = document.querySelector<HTMLInputElement>("#tog-spot")!;
  const togTrail = document.querySelector<HTMLInputElement>("#tog-trail")!;
  const togDot = document.querySelector<HTMLInputElement>("#tog-dot")!;
  const togPointer = document.querySelector<HTMLInputElement>("#tog-pointer")!;
  const togLearn = document.querySelector<HTMLInputElement>("#tog-learn")!;
  const rngZoom = document.querySelector<HTMLInputElement>("#rng-zoom")!;
  const zoomVal = document.querySelector<HTMLElement>("#zoom-val")!;
  const clrGuide = document.querySelector<HTMLInputElement>("#clr-guide")!;

  const engine = new WebGazerEngine();
  const overlay = new ReadingOverlay(readerRoot);
  const recorder = new SessionRecorder();
  const btnRecord = document.querySelector<HTMLButtonElement>("#btn-record")!;
  const loadText = document.querySelector<HTMLTextAreaElement>("#load-text")!;
  const btnLoad = document.querySelector<HTMLButtonElement>("#btn-load")!;
  const loadNote = document.querySelector<HTMLElement>("#load-note")!;
  const recStatus = document.querySelector<HTMLElement>("#rec-status")!;
  const recPill = document.querySelector<HTMLElement>("#rec-pill")!;
  const videoBadge = document.querySelector<HTMLElement>("#video-badge")!;
  let pointerMode = false;
  let calibrating = false;

  const fmtElapsed = (ms: number): string => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const paintRecorder = (view: RecorderView) => {
    const live = view.phase === "recording" || view.phase === "starting";
    const textLocked = view.phase !== "idle";
    loadText.disabled = textLocked;
    btnLoad.disabled = textLocked;
    btnRecord.classList.toggle("live", live);
    btnRecord.textContent =
      view.phase === "stopping" ? "Saving…" : live ? "Stop" : "Record";
    btnRecord.disabled = view.phase === "stopping";
    recPill.hidden = view.phase !== "recording";
    if (view.phase === "starting") {
      recStatus.textContent = "Starting camera and microphone…";
    }
    if (view.phase === "recording") {
      const mic = view.voice === "live" ? "mic" : "mic off";
      const cam = view.camera === "live" ? "camera" : "camera off";
      recPill.textContent = `Recording · ${cam} + ${mic} · local`;
      recStatus.textContent = `${fmtElapsed(view.elapsedMs)} · ${view.dir || "opening…"}`;
      videoBadge.textContent = "Recording · this machine";
    } else if (view.phase === "idle" && !view.fault) {
      videoBadge.textContent = "Preview · this machine";
    }
    if (view.fault && view.phase !== "recording") {
      recStatus.textContent = view.fault;
    }
  };
  recorder.setChangeHandler(paintRecorder);

  const toggleRecord = async () => {
    if (recorder.isRecording()) {
      btnRecord.disabled = true;
      try {
        const saved = await recorder.stop();
        if (!saved) {
          btnRecord.disabled = recorder.view().phase === "stopping";
          return;
        }
        const summary = saved.summary;
        const gaze =
          summary && typeof summary === "object" ? readNumber(summary, "gaze_samples") : null;
        const line =
          summary && typeof summary === "object" ? readNumber(summary, "line_coverage") : null;
        const linePct = line === null ? "—" : `${Math.round(line * 100)}%`;
        recStatus.textContent = `Saved ${saved.dir} · ${gaze ?? 0} gaze rows · ${linePct} on a line`;
        toast(saved.fault ? `Saved with a fault · ${saved.dir}` : `Saved ${saved.sessionId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recStatus.textContent = message;
        toast("Record stopped before the session could close");
      }
      return;
    }
    btnRecord.disabled = true;
    try {
      await recorder.start({
        ensureCamera: async () => {
          if (pointerMode) return;
          await engine.start();
          btnCamera.disabled = true;
          btnCamera.textContent = "Camera live";
          btnCalibrate.disabled = false;
          btnRecal.disabled = false;
        },
        gazeSource: () => (pointerMode ? "pointer" : "webgazer"),
        videoEl: () => engine.cameraVideo(),
        readEyes: () => engine.readEyes(),
        attention: () => overlay.getAttention(),
        blocks: (withText) => overlay.listBlocks(withText),
        blockElement: (id) => overlay.blockById(id),
      });
      const view = recorder.view();
      if (view.voice !== "live") toast("Mic blocked — camera, gaze, and text are still recording");
    } catch (err) {
      if (err instanceof RecordingCancelled) {
        recStatus.textContent =
          "Off. Record writes the camera, microphone, gaze, and the line you were on to this machine.";
        btnRecord.disabled = false;
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      recStatus.textContent = message;
      toast(message);
      btnRecord.disabled = false;
    }
  };

  const setUiStatus = (s: EngineStatus, detail?: string) => {
    statusDot.className = `status-dot ${statusClass(s)}`;
    statusText.textContent = detail ? `${statusLabel(s)} — ${detail}` : statusLabel(s);
  };

  engine.setStatusHandler(setUiStatus);

  overlay.setStateHandler((state) => {
    metricState.textContent = state.charAt(0) + state.slice(1).toLowerCase();
  });

  engine.setFrameHandler((frame) => {
    metricSamples.textContent = String(engine.getSamplesTaught());
    if (!pointerMode && !calibrating) {
      overlay.update(frame.filtered, {
        speed: frame.speed,
        confidence: frame.confidence,
        faceDetected: frame.faceDetected,
      });
    }
    recorder.observe(frame, "webgazer");
  });

  const onPointerMove = (e: PointerEvent) => {
    if (!pointerMode || calibrating) return;
    const point = { x: e.clientX, y: e.clientY };
    overlay.update(point, { speed: 0, confidence: 1, faceDetected: true });
    recorder.observe(
      { raw: point, filtered: point, confidence: 1, faceDetected: false, speed: 0 },
      "pointer",
    );
  };
  window.addEventListener("pointermove", onPointerMove);

  // Shift+click (or normal click when learn is on) teaches gaze at cursor.
  window.addEventListener(
    "click",
    (e) => {
      if (pointerMode || calibrating || !togLearn.checked) return;
      if (!engine.getSamplesTaught() && !e.shiftKey) return;
      // Always teach on shift-click; also on plain click after some training.
      if (e.shiftKey || engine.getSamplesTaught() >= 20) {
        engine.teach({ x: e.clientX, y: e.clientY }, 5);
        metricSamples.textContent = String(engine.getSamplesTaught());
        recorder.note({
          type: "teach",
          x: Math.round(e.clientX * 10) / 10,
          y: Math.round(e.clientY * 10) / 10,
          source: e.shiftKey ? "shift_click" : "click",
        });
        if (e.shiftKey) {
          toast("Learned this point (shift+click)");
        }
      }
    },
    true,
  );

  const doCalibrate = async () => {
    if (calibrating) return;
    calibrating = true;
    overlay.updateSettings({ enabled: false });
    btnCalibrate.disabled = true;
    btnRecal.disabled = true;

    const result = await runCalibration(engine, {
      overlay: document.getElementById("cal-overlay")!,
      target: document.getElementById("cal-target")!,
      title: document.getElementById("cal-title")!,
      msg: document.getElementById("cal-msg")!,
      ring: document.getElementById("cal-ring")!,
    });

    calibrating = false;
    overlay.updateSettings({ enabled: togEnabled.checked });
    btnCalibrate.disabled = false;
    btnRecal.disabled = false;
    metricSamples.textContent = String(result.samples);
    metricError.textContent =
      result.meanErrorPx > 500 ? "—" : `±${Math.round(result.meanErrorPx)}px`;

    recorder.note({
      type: "calibration",
      ok: result.ok,
      mean_error_px: Math.round(result.meanErrorPx),
      samples: result.samples,
    });

    if (result.ok) {
      toast(
        result.meanErrorPx < 120
          ? `Locked in · ~${Math.round(result.meanErrorPx)}px error`
          : `Calibrated · ~${Math.round(result.meanErrorPx)}px — click while reading to refine`,
      );
      setUiStatus("tracking", `${result.samples} samples`);
    } else {
      toast("Calibration weak — try again with steadier gaze");
      setUiStatus("ready", "retry calibration");
    }
  };

  btnLoad.addEventListener("click", () => {
    if (recorder.isRecording()) {
      toast("Stop the take before changing the text.");
      return;
    }
    try {
      overlay.resetReading();
      const blocks = loadReading(readerRoot, loadText.value);
      metricDone.textContent = "0";
      metricState.textContent = "Away";
      window.scrollTo(0, 0);
      loadNote.textContent = `Your text · ${blocks} blocks. Record will save this, not the sample.`;
      toast(`Loaded ${blocks} blocks`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast(message);
    }
  });

  btnRecord.addEventListener("click", () => void toggleRecord());

  window.addEventListener("pagehide", () => {
    if (recorder.isRecording()) void recorder.stop();
  });

  btnCamera.addEventListener("click", async () => {
    btnCamera.disabled = true;
    try {
      await engine.start();
      btnCalibrate.disabled = false;
      btnRecal.disabled = false;
      btnCamera.textContent = "Camera live";
      toast("Camera on — run Full calibrate for best accuracy");
    } catch {
      btnCamera.disabled = false;
    }
  });

  btnCalibrate.addEventListener("click", () => void doCalibrate());
  btnRecal.addEventListener("click", () => void doCalibrate());

  togEnabled.addEventListener("change", () => {
    overlay.updateSettings({ enabled: togEnabled.checked });
  });
  togSpot.addEventListener("change", () => {
    overlay.updateSettings({ spotlight: togSpot.checked });
  });
  togTrail.addEventListener("change", () => {
    overlay.updateSettings({ showTrail: togTrail.checked });
  });
  togDot.addEventListener("change", () => {
    overlay.updateSettings({ showGazeDot: togDot.checked });
  });
  togPointer.addEventListener("change", () => {
    pointerMode = togPointer.checked;
    if (pointerMode) {
      setUiStatus("tracking", "pointer mode");
      statusDot.className = "status-dot ok";
      statusText.textContent = "Pointer mode — move over the article";
    }
  });
  rngZoom.addEventListener("input", () => {
    const z = Number(rngZoom.value);
    zoomVal.textContent = `${z.toFixed(2)}×`;
    overlay.updateSettings({ zoom: z });
  });
  clrGuide.addEventListener("input", () => {
    overlay.updateSettings({ guideColor: clrGuide.value });
  });

  const isTypingTarget = (t: EventTarget | null): boolean => {
    if (!(t instanceof HTMLElement)) return false;
    if (t instanceof HTMLTextAreaElement) return true;
    if (t.isContentEditable) return true;
    if (t instanceof HTMLInputElement) {
      // Allow Space/G/C globally except when typing real text.
      const type = (t.type || "text").toLowerCase();
      return ["text", "search", "email", "url", "password", "number"].includes(type);
    }
    return false;
  };

  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) return;

    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      void toggleRecord();
    }
    if (e.key === "g" || e.key === "G") {
      togEnabled.checked = !togEnabled.checked;
      overlay.updateSettings({ enabled: togEnabled.checked });
    }
    if ((e.key === "c" || e.key === "C") && !btnCalibrate.disabled) {
      void doCalibrate();
    }
    // Space = finished this paragraph (weak label + advance).
    if (e.code === "Space" || e.key === " ") {
      if (calibrating) return;
      e.preventDefault();
      const result = overlay.confirmParagraph();
      if (!result.ok || !result.trainPoint) {
        toast("No paragraph to confirm");
        return;
      }
      metricDone.textContent = String(overlay.getConfirmedCount());
      const confirmedText = (result.el?.innerText || "").replace(/\s+/g, " ").trim();
      recorder.note({
        type: "confirm",
        block_id: result.blockId,
        text_hash: confirmedText ? textHash(confirmedText) : null,
        train_x: result.trainPoint ? Math.round(result.trainPoint.x * 10) / 10 : null,
        train_y: result.trainPoint ? Math.round(result.trainPoint.y * 10) / 10 : null,
        index: result.index,
        total: result.total,
      });
      if (togLearn.checked && !pointerMode) {
        engine.teach(result.trainPoint, 8);
        metricSamples.textContent = String(engine.getSamplesTaught());
      }
      toast(
        result.index + 1 >= result.total
          ? "Article complete ✓"
          : `Paragraph done · ${overlay.getConfirmedCount()} marked`,
      );
    }
  });
}

mount();
