import type { CalibrationPoint, Point } from "./types";
import type { WebGazerEngine } from "./webgazerEngine";

/** Dense 4×4 grid + center emphasis — more samples = better ridge fit. */
export function buildCalibrationGrid(): CalibrationPoint[] {
  const xs = [0.08, 0.36, 0.64, 0.92];
  const ys = [0.1, 0.36, 0.64, 0.9];
  const pts: CalibrationPoint[] = [];
  let id = 0;
  for (const ny of ys) {
    for (const nx of xs) {
      pts.push({ id: id++, nx, ny });
    }
  }
  // Extra center samples for reading column.
  pts.push({ id: id++, nx: 0.42, ny: 0.5 });
  pts.push({ id: id++, nx: 0.5, ny: 0.5 });
  pts.push({ id: id++, nx: 0.58, ny: 0.5 });
  return pts;
}

export type CalibUi = {
  overlay: HTMLElement;
  target: HTMLElement;
  title: HTMLElement;
  msg: HTMLElement;
  ring: HTMLElement;
};

export type CalibResult = {
  ok: boolean;
  meanErrorPx: number;
  samples: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toScreen(p: CalibrationPoint): Point {
  return {
    x: p.nx * window.innerWidth,
    y: p.ny * window.innerHeight,
  };
}

/** Timing tuned for reading-pace stare (slow enough to land, not frantic). */
const SETTLE_MS = 900;
const TEACH_MS = 2200;
const TEACH_INTERVAL_MS = 120;
const TEACH_BURST = 5;
const VAL_SETTLE_MS = 1100;
const VAL_HOLD_MS = 700;

/**
 * Guided calibration: move → settle → long teach while user stares.
 * Ends with a slower validation pass that reports mean pixel error.
 */
export async function runCalibration(
  engine: WebGazerEngine,
  ui: CalibUi,
  opts?: { onProgress?: (i: number, n: number) => void },
): Promise<CalibResult> {
  const points = buildCalibrationGrid();
  engine.setCalibrating(true);
  await engine.clearCalibration();

  ui.overlay.classList.add("active");
  ui.overlay.setAttribute("aria-hidden", "false");
  ui.title.textContent = "Calibration";
  ui.msg.textContent =
    "Slower on purpose. Head still, stare the center until the target moves. ~1–2 min.";

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const screen = toScreen(p);
    ui.target.style.left = `${screen.x}px`;
    ui.target.style.top = `${screen.y}px`;
    ui.target.classList.remove("pulse");
    void ui.target.offsetWidth;
    ui.target.classList.add("pulse");
    ui.ring.style.left = `${screen.x}px`;
    ui.ring.style.top = `${screen.y}px`;
    ui.title.textContent = `Point ${i + 1} / ${points.length}`;
    ui.msg.textContent = "Find the target… hold still on the center.";
    opts?.onProgress?.(i + 1, points.length);

    // Time to saccade to the target before we trust the samples.
    await sleep(SETTLE_MS);
    ui.msg.textContent = "Hold… learning this point.";

    const t0 = performance.now();
    while (performance.now() - t0 < TEACH_MS) {
      engine.teach(screen, TEACH_BURST);
      await sleep(TEACH_INTERVAL_MS);
    }
  }

  // Validation: fewer points, longer holds, still lightly teach.
  ui.title.textContent = "Validating accuracy…";
  ui.msg.textContent = "Same idea — stare the center. Almost done.";
  const valPts = [points[0], points[5], points[10], points[15], points[17]].filter(
    Boolean,
  );
  const errors: number[] = [];

  for (const p of valPts) {
    const screen = toScreen(p);
    ui.target.style.left = `${screen.x}px`;
    ui.target.style.top = `${screen.y}px`;
    ui.ring.style.left = `${screen.x}px`;
    ui.ring.style.top = `${screen.y}px`;
    await sleep(VAL_SETTLE_MS);
    engine.teach(screen, 4);
    await sleep(VAL_HOLD_MS);
    const pred = engine.getLastFiltered();
    if (pred) {
      const err = Math.hypot(pred.x - screen.x, pred.y - screen.y);
      errors.push(err);
      engine.noteValidationError(err);
    }
  }

  ui.overlay.classList.remove("active");
  ui.overlay.setAttribute("aria-hidden", "true");
  engine.setCalibrating(false);

  const meanErrorPx =
    errors.length === 0
      ? 999
      : errors.reduce((a, b) => a + b, 0) / errors.length;

  return {
    ok: engine.getSamplesTaught() >= 40,
    meanErrorPx,
    samples: engine.getSamplesTaught(),
  };
}
