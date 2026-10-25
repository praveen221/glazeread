import type { Point } from "../gaze/types";
import { ReadingStateMachine, type ReadingState, type StateSnapshot } from "../reading/stateMachine";

export type OverlaySettings = {
  enabled: boolean;
  zoom: number;
  guideColor: string;
  showGazeDot: boolean;
  showTrail: boolean;
  spotlight: boolean;
  dwellMs: number;
  saccadeThreshold: number;
};

export type OverlayMeta = {
  speed?: number;
  confidence?: number;
  faceDetected?: boolean;
};

export type ConfirmResult = {
  ok: boolean;
  el: HTMLElement | null;
  /** Stable id assigned on the block. Null when nothing was confirmed. */
  blockId: string | null;
  /** Center of confirmed paragraph — good weak label for gaze training. */
  trainPoint: Point | null;
  index: number;
  total: number;
};

export type BlockView = {
  id: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  done: boolean;
  active: boolean;
};

export type AttentionSnapshot = {
  state: ReadingState;
  reason: string;
  freeze: boolean;
  gaze: Point | null;
  confidence: number;
  speed: number;
  faceDetected: boolean;
  block: BlockView | null;
  /** Paragraph the overlay has committed to zooming. Can lag the hit. */
  focusId: string | null;
};

const DEFAULTS: OverlaySettings = {
  enabled: true,
  zoom: 1.1,
  guideColor: "#34d399",
  showGazeDot: true,
  showTrail: true,
  spotlight: true,
  dwellMs: 140,
  saccadeThreshold: 38,
};

const STATE_LABEL: Record<ReadingState, string> = {
  READING: "Reading",
  SEARCHING: "Searching",
  AWAY: "Away",
  HESITATING: "Hesitating",
};

/**
 * Demo-grade reading overlay + attention state machine + Space-to-confirm.
 */
export class ReadingOverlay {
  private settings: OverlaySettings = { ...DEFAULTS };
  private activeEl: HTMLElement | null = null;
  private candidateEl: HTMLElement | null = null;
  private candidateSince = 0;
  private lastGaze: Point | null = null;
  private lastSpeed = 0;
  private confidence = 0.5;
  private faceDetected = true;
  private raf = 0;
  private guide: HTMLDivElement;
  private gazeDot: HTMLDivElement;
  private spotlight: HTMLDivElement;
  private trailCanvas: HTMLCanvasElement;
  private trailCtx: CanvasRenderingContext2D;
  private trail: Point[] = [];
  private root: HTMLElement;
  private styleEl: HTMLStyleElement;
  private confEl: HTMLDivElement | null = null;
  private readonly fsm = new ReadingStateMachine();
  private lastSnap: StateSnapshot = this.fsm.get();
  private lastState: ReadingState = "AWAY";
  private onStateChange?: (s: ReadingState, reason: string) => void;
  private confirmedCount = 0;
  private nextBlockId = 0;
  private textCache = new WeakMap<HTMLElement, { n: number; text: string }>();

  constructor(root: HTMLElement) {
    this.root = root;

    this.styleEl = document.createElement("style");
    this.styleEl.textContent = `
      .glaze-focus {
        position: relative;
        z-index: 5;
        transform: scale(var(--glaze-zoom, 1.1)) translateZ(0);
        transform-origin: center center;
        transition:
          transform 220ms cubic-bezier(.2,.8,.2,1),
          background-color 220ms ease,
          box-shadow 220ms ease,
          filter 220ms ease,
          opacity 220ms ease;
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--glaze-guide, #34d399) 10%, transparent),
          color-mix(in srgb, var(--glaze-guide, #34d399) 4%, transparent) 60%,
          transparent
        );
        border-radius: 10px;
        box-shadow:
          0 12px 40px rgba(0,0,0,.18),
          0 0 0 1px color-mix(in srgb, var(--glaze-guide, #34d399) 35%, transparent),
          0 0 28px color-mix(in srgb, var(--glaze-guide, #34d399) 22%, transparent);
        filter: contrast(1.04) saturate(1.05);
      }
      .glaze-focus.glaze-frozen {
        filter: contrast(1) saturate(0.9);
        box-shadow:
          0 8px 24px rgba(0,0,0,.12),
          0 0 0 1px color-mix(in srgb, var(--glaze-guide, #34d399) 18%, transparent);
      }
      .glaze-done {
        opacity: 0.55;
        transition: opacity 280ms ease;
      }
      .glaze-done::after {
        content: "✓";
        position: absolute;
        right: 8px;
        top: 6px;
        font: 600 12px/1 "IBM Plex Sans", system-ui, sans-serif;
        color: var(--glaze-guide, #34d399);
        opacity: 0.85;
      }
      .glaze-focus::before {
        content: "";
        position: absolute;
        inset: -2px;
        border-radius: 12px;
        pointer-events: none;
        background: linear-gradient(
          120deg,
          color-mix(in srgb, var(--glaze-guide, #34d399) 35%, transparent),
          transparent 40%,
          transparent 60%,
          color-mix(in srgb, var(--glaze-guide, #34d399) 20%, transparent)
        );
        opacity: 0.55;
        mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        mask-composite: exclude;
        padding: 1px;
      }
      .glaze-guide-line {
        position: fixed;
        left: 0;
        height: 3px;
        border-radius: 999px;
        pointer-events: none;
        z-index: 9998;
        opacity: 0;
        transition: opacity 140ms ease;
        background: linear-gradient(
          90deg,
          transparent,
          var(--glaze-guide, #34d399) 12%,
          var(--glaze-guide, #34d399) 88%,
          transparent
        );
        box-shadow:
          0 0 12px color-mix(in srgb, var(--glaze-guide, #34d399) 70%, transparent),
          0 0 28px color-mix(in srgb, var(--glaze-guide, #34d399) 40%, transparent);
      }
      .glaze-guide-line.visible { opacity: 0.95; }
      .glaze-guide-line.frozen { opacity: 0.35 !important; filter: grayscale(0.4); }
      .glaze-guide-line::after {
        content: "";
        position: absolute;
        right: 8%;
        top: 50%;
        width: 8px;
        height: 8px;
        margin-top: -4px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0 10px var(--glaze-guide, #34d399);
        opacity: 0.9;
      }
      .glaze-gaze-dot {
        position: fixed;
        width: 14px;
        height: 14px;
        margin: -7px 0 0 -7px;
        border-radius: 50%;
        pointer-events: none;
        z-index: 9999;
        opacity: 0;
        background: radial-gradient(circle at 35% 35%, #fff, var(--glaze-guide, #34d399) 55%, transparent 70%);
        box-shadow: 0 0 16px color-mix(in srgb, var(--glaze-guide, #34d399) 80%, transparent);
        transition: opacity 100ms ease;
        mix-blend-mode: screen;
      }
      .glaze-gaze-dot.visible { opacity: 0.85; }
      .glaze-spotlight {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 4;
        opacity: 0;
        transition: opacity 280ms ease;
        background: radial-gradient(
          480px 320px at var(--spot-x, 50%) var(--spot-y, 40%),
          transparent 0%,
          transparent 28%,
          rgba(0,0,0,0.22) 55%,
          rgba(0,0,0,0.45) 100%
        );
      }
      .glaze-spotlight.on { opacity: 1; }
      .glaze-spotlight.dim { opacity: 0.35; }
      .glaze-trail {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 9997;
      }
      .glaze-hud {
        position: fixed;
        left: 16px;
        bottom: 16px;
        z-index: 10001;
        font: 600 12px/1.2 "IBM Plex Sans", system-ui, sans-serif;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #e8eaef;
        background: rgba(12,14,18,0.78);
        border: 1px solid rgba(255,255,255,0.1);
        backdrop-filter: blur(10px);
        border-radius: 14px;
        padding: 0.55rem 0.8rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        pointer-events: none;
        min-width: 168px;
      }
      .glaze-hud-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .glaze-state-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border-radius: 999px;
        padding: 0.2rem 0.55rem;
        font-size: 0.72rem;
        letter-spacing: 0.06em;
        background: rgba(255,255,255,0.08);
      }
      .glaze-state-chip.reading { background: rgba(52,211,153,0.22); color: #6ee7b7; }
      .glaze-state-chip.searching { background: rgba(251,191,36,0.2); color: #fcd34d; }
      .glaze-state-chip.away { background: rgba(148,163,184,0.2); color: #cbd5e1; }
      .glaze-state-chip.hesitating { background: rgba(96,165,250,0.22); color: #93c5fd; }
      .glaze-state-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 8px currentColor;
      }
      .glaze-conf-bar {
        width: 72px;
        height: 6px;
        border-radius: 999px;
        background: rgba(255,255,255,0.12);
        overflow: hidden;
      }
      .glaze-conf-fill {
        height: 100%;
        width: 0%;
        border-radius: inherit;
        background: linear-gradient(90deg, #f59e0b, #34d399);
        transition: width 180ms ease;
      }
      .glaze-hud-hint {
        font-size: 0.68rem;
        letter-spacing: 0.02em;
        text-transform: none;
        font-weight: 500;
        color: #9aa3b5;
      }
    `;
    document.head.appendChild(this.styleEl);

    this.spotlight = document.createElement("div");
    this.spotlight.className = "glaze-spotlight";
    document.body.appendChild(this.spotlight);

    this.trailCanvas = document.createElement("canvas");
    this.trailCanvas.className = "glaze-trail";
    document.body.appendChild(this.trailCanvas);
    const ctx = this.trailCanvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas unsupported");
    this.trailCtx = ctx;
    this.resizeTrail();
    window.addEventListener("resize", () => this.resizeTrail());

    this.guide = document.createElement("div");
    this.guide.className = "glaze-guide-line";
    document.body.appendChild(this.guide);

    this.gazeDot = document.createElement("div");
    this.gazeDot.className = "glaze-gaze-dot";
    document.body.appendChild(this.gazeDot);

    this.confEl = document.createElement("div");
    this.confEl.className = "glaze-hud";
    this.confEl.innerHTML = `
      <div class="glaze-hud-row">
        <span class="glaze-state-chip away" id="glaze-state-chip">
          <span class="glaze-state-dot"></span>
          <span id="glaze-state-label">Away</span>
        </span>
      </div>
      <div class="glaze-hud-row">
        <span>Lock</span>
        <div class="glaze-conf-bar"><div class="glaze-conf-fill" id="glaze-conf-fill"></div></div>
        <span id="glaze-conf-pct">—</span>
      </div>
      <div class="glaze-hud-hint" id="glaze-hud-hint">Space · mark paragraph done</div>
    `;
    document.body.appendChild(this.confEl);

    this.applyCssVars();
    this.raf = requestAnimationFrame(this.tick);
  }

  setStateHandler(fn: (s: ReadingState, reason: string) => void): void {
    this.onStateChange = fn;
  }

  getState(): ReadingState {
    return this.lastState;
  }

  getConfirmedCount(): number {
    return this.confirmedCount;
  }

  /** Drop focus and block ids after the article DOM is replaced. */
  resetReading(): void {
    this.clearFocus();
    this.confirmedCount = 0;
    this.nextBlockId = 0;
    this.fsm.reset();
    this.lastSnap = this.fsm.get();
    this.lastState = "AWAY";
    this.onStateChange?.(this.lastState, this.lastSnap.reason);
  }

  getActiveElement(): HTMLElement | null {
    return this.activeEl;
  }

  getAttention(): AttentionSnapshot {
    const gaze = this.lastGaze ? { ...this.lastGaze } : null;
    return {
      state: this.lastSnap.state,
      reason: this.lastSnap.reason,
      freeze: this.lastSnap.freeze,
      gaze,
      confidence: this.confidence,
      speed: this.lastSpeed,
      faceDetected: this.faceDetected,
      block: gaze ? this.describeHit(gaze) : null,
      focusId: this.activeEl ? this.idFor(this.activeEl) : null,
    };
  }

  /** Block currently under the gaze, including before the overlay commits focus. */
  private describeHit(gaze: Point): BlockView | null {
    const hit = this.hitReadable(gaze);
    return hit ? this.describe(hit, true) : null;
  }

  listBlocks(withText: boolean): BlockView[] {
    return this.readableBlocks().map((el) => this.describe(el, withText));
  }

  blockById(id: string): HTMLElement | null {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
    const el = this.root.querySelector(`[data-glaze-block="${id}"]`);
    return el instanceof HTMLElement ? el : null;
  }

  getSettings(): OverlaySettings {
    return { ...this.settings };
  }

  updateSettings(partial: Partial<OverlaySettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.applyCssVars();
    if (!this.settings.enabled) {
      this.clearFocus();
      this.guide.classList.remove("visible");
      this.gazeDot.classList.remove("visible");
      this.spotlight.classList.remove("on");
      this.trail = [];
      this.fsm.reset();
    }
    this.spotlight.classList.toggle("on", this.settings.enabled && this.settings.spotlight);
  }

  update(gaze: Point | null, meta?: OverlayMeta): void {
    this.lastGaze = gaze ? { ...gaze } : null;
    if (meta?.speed !== undefined) this.lastSpeed = meta.speed;
    if (meta?.confidence !== undefined) this.confidence = meta.confidence;
    if (meta?.faceDetected !== undefined) this.faceDetected = meta.faceDetected;
  }

  /**
   * Space: mark current paragraph done, teach gaze at its center, advance focus.
   */
  confirmParagraph(): ConfirmResult {
    const blocks = this.readableBlocks();
    if (!blocks.length) {
      return { ok: false, el: null, blockId: null, trainPoint: null, index: -1, total: 0 };
    }

    let el = this.activeEl;
    // Never re-confirm an already-done block; always pick next incomplete.
    if (!el || !blocks.includes(el) || el.classList.contains("glaze-done")) {
      el =
        blocks.find((b) => !b.classList.contains("glaze-done") && this.inViewport(b)) ??
        blocks.find((b) => !b.classList.contains("glaze-done")) ??
        null;
    }
    if (!el) {
      return { ok: false, el: null, blockId: null, trainPoint: null, index: -1, total: blocks.length };
    }

    const index = blocks.indexOf(el);
    const rect = el.getBoundingClientRect();
    const trainPoint = {
      x: rect.left + rect.width * 0.45,
      y: rect.top + Math.min(rect.height * 0.45, 40),
    };

    el.classList.add("glaze-done");
    el.classList.remove("glaze-focus", "glaze-frozen");
    this.confirmedCount++;
    this.activeEl = null;
    this.candidateEl = null;

    // Advance to next incomplete readable block.
    const next =
      blocks.slice(index + 1).find((b) => !b.classList.contains("glaze-done")) ??
      blocks.find((b) => !b.classList.contains("glaze-done")) ??
      null;
    if (next) {
      this.setFocus(next, true);
    } else {
      this.guide.classList.remove("visible");
    }

    return {
      ok: true,
      el,
      blockId: this.idFor(el),
      trainPoint,
      index,
      total: blocks.length,
    };
  }

  private idFor(el: HTMLElement): string {
    const existing = el.dataset.glazeBlock;
    if (existing) return existing;
    const id = `b${String(this.nextBlockId).padStart(4, "0")}`;
    this.nextBlockId += 1;
    el.dataset.glazeBlock = id;
    return id;
  }

  private textFor(el: HTMLElement): string {
    const n = el.textContent?.length ?? 0;
    const cached = this.textCache.get(el);
    if (cached && cached.n === n) return cached.text;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    this.textCache.set(el, { n, text });
    return text;
  }

  private describe(el: HTMLElement, withText: boolean): BlockView {
    const rect = el.getBoundingClientRect();
    return {
      id: this.idFor(el),
      tag: el.tagName.toLowerCase(),
      text: withText ? this.textFor(el) : "",
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      done: el.classList.contains("glaze-done"),
      active: el === this.activeEl,
    };
  }

  private readableBlocks(): HTMLElement[] {
    const nodes = this.root.querySelectorAll<HTMLElement>(
      "p, li, blockquote, h1, h2, h3, h4, pre, .glaze-readable",
    );
    return [...nodes].filter((el) => this.isReadable(el));
  }

  private inViewport(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return r.bottom > 80 && r.top < window.innerHeight - 40;
  }

  private applyCssVars(): void {
    document.documentElement.style.setProperty("--glaze-zoom", String(this.settings.zoom));
    document.documentElement.style.setProperty("--glaze-guide", this.settings.guideColor);
    this.guide.style.setProperty("--glaze-guide", this.settings.guideColor);
  }

  private resizeTrail(): void {
    this.trailCanvas.width = window.innerWidth * devicePixelRatio;
    this.trailCanvas.height = window.innerHeight * devicePixelRatio;
    this.trailCanvas.style.width = `${window.innerWidth}px`;
    this.trailCanvas.style.height = `${window.innerHeight}px`;
    this.trailCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  private tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    this.apply(this.lastGaze);
    this.drawTrail();
  };

  private apply(gaze: Point | null): void {
    const fill = document.getElementById("glaze-conf-fill");
    const pct = document.getElementById("glaze-conf-pct");
    if (fill && pct) {
      const c = Math.round(this.confidence * 100);
      fill.style.width = `${c}%`;
      pct.textContent = `${c}%`;
    }

    if (!this.settings.enabled) {
      this.gazeDot.classList.remove("visible");
      return;
    }

    const hit = gaze ? this.hitReadable(gaze) : null;
    const snap = this.fsm.update({
      now: performance.now(),
      gaze,
      speed: this.lastSpeed,
      confidence: this.confidence,
      faceDetected: this.faceDetected && !!gaze,
      onReadable: !!hit,
      sameParagraph: !!hit && hit === this.activeEl,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    });

    this.lastSnap = snap;
    if (snap.state !== this.lastState) {
      this.lastState = snap.state;
      this.onStateChange?.(snap.state, snap.reason);
    }
    this.renderStateChip(snap.state, snap.reason);

    const freeze = snap.freeze;

    if (!gaze) {
      this.gazeDot.classList.remove("visible");
      this.spotlight.classList.toggle("dim", true);
      return;
    }

    document.documentElement.style.setProperty("--spot-x", `${gaze.x}px`);
    document.documentElement.style.setProperty("--spot-y", `${gaze.y}px`);
    if (this.settings.spotlight) {
      this.spotlight.classList.add("on");
      this.spotlight.classList.toggle("dim", freeze && snap.state === "AWAY");
    }

    if (this.settings.showGazeDot) {
      this.gazeDot.style.left = `${gaze.x}px`;
      this.gazeDot.style.top = `${gaze.y}px`;
      this.gazeDot.style.opacity = String(
        freeze ? 0.25 : 0.4 + this.confidence * 0.55,
      );
      this.gazeDot.classList.add("visible");
    } else {
      this.gazeDot.classList.remove("visible");
    }

    if (this.settings.showTrail && !freeze) {
      this.trail.push({ ...gaze });
      if (this.trail.length > 28) this.trail.shift();
    } else if (freeze && snap.state === "AWAY") {
      this.trail = [];
    }

    const now = performance.now();
    // Only change paragraph focus while actively reading (not away/searching).
    if (!freeze && hit) {
      if (hit !== this.candidateEl) {
        this.candidateEl = hit;
        this.candidateSince = now;
      }
      if (
        hit !== this.activeEl &&
        now - this.candidateSince >= this.settings.dwellMs
      ) {
        this.setFocus(hit, false);
      }
    }

    if (this.activeEl) {
      this.activeEl.classList.toggle("glaze-frozen", freeze);
      if (!freeze) {
        this.placeGuide(this.activeEl, gaze);
        this.guide.classList.remove("frozen");
      } else {
        this.guide.classList.add("frozen");
      }
    } else {
      this.guide.classList.remove("visible");
    }
  }

  private renderStateChip(state: ReadingState, reason: string): void {
    const chip = document.getElementById("glaze-state-chip");
    const label = document.getElementById("glaze-state-label");
    const hint = document.getElementById("glaze-hud-hint");
    if (!chip || !label) return;
    chip.className = `glaze-state-chip ${state.toLowerCase()}`;
    label.textContent = STATE_LABEL[state];
    if (hint) {
      if (state === "AWAY") hint.textContent = "Frozen · look back at the text";
      else if (state === "SEARCHING") hint.textContent = "Scanning · focus holds";
      else if (state === "HESITATING") hint.textContent = "Space · done with this block";
      else hint.textContent = "Space · mark paragraph done";
      hint.title = reason;
    }
  }

  private drawTrail(): void {
    const ctx = this.trailCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!this.settings.enabled || !this.settings.showTrail || this.trail.length < 2) {
      return;
    }
    const color = this.settings.guideColor;
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const t = i / this.trail.length;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = t * 0.55;
      ctx.lineWidth = 1 + t * 3;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private hitReadable(gaze: Point): HTMLElement | null {
    this.guide.style.pointerEvents = "none";
    this.gazeDot.style.pointerEvents = "none";
    this.spotlight.style.pointerEvents = "none";
    this.trailCanvas.style.pointerEvents = "none";

    let node = document.elementFromPoint(gaze.x, gaze.y) as HTMLElement | null;

    while (node && node !== document.body) {
      if (this.root.contains(node) && this.isReadable(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  private isReadable(el: HTMLElement): boolean {
    const tag = el.tagName.toLowerCase();
    if (["p", "li", "blockquote", "h1", "h2", "h3", "h4", "pre"].includes(tag)) {
      return true;
    }
    return el.classList.contains("glaze-readable");
  }

  private setFocus(el: HTMLElement, forceScroll: boolean): void {
    if (this.activeEl === el) {
      if (forceScroll) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return;
    }
    if (this.activeEl) {
      this.activeEl.classList.remove("glaze-focus", "glaze-frozen");
    }
    this.activeEl = el;
    el.classList.add("glaze-focus");
    const rect = el.getBoundingClientRect();
    if (
      forceScroll ||
      rect.top < 80 ||
      rect.bottom > window.innerHeight - 80
    ) {
      el.scrollIntoView({
        block: forceScroll ? "center" : "nearest",
        behavior: "smooth",
      });
    }
  }

  private clearFocus(): void {
    if (this.activeEl) {
      this.activeEl.classList.remove("glaze-focus", "glaze-frozen");
    }
    this.activeEl = null;
    this.candidateEl = null;
  }

  private placeGuide(el: HTMLElement, gaze: Point): void {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    let lineHeight = parseFloat(style.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      lineHeight = (parseFloat(style.fontSize) || 16) * 1.55;
    }
    const relY = Math.min(Math.max(gaze.y - rect.top, 0), Math.max(0, rect.height - 1));
    const lineIndex = Math.floor(relY / lineHeight);
    const top = rect.top + lineIndex * lineHeight + lineHeight * 0.92;
    const pad = 6;
    this.guide.style.left = `${rect.left + pad}px`;
    this.guide.style.top = `${top}px`;
    this.guide.style.width = `${Math.max(0, rect.width - pad * 2)}px`;
    this.guide.style.opacity = String(0.55 + this.confidence * 0.45);
    this.guide.classList.add("visible");
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.clearFocus();
    this.guide.remove();
    this.gazeDot.remove();
    this.spotlight.remove();
    this.trailCanvas.remove();
    this.confEl?.remove();
    this.styleEl.remove();
  }
}
