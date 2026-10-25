/**
 * One Euro Filter — standard for noisy interactive signals (Casiez et al.).
 * Low lag when moving, strong smoothing when still.
 */
export class OneEuroFilter1D {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x: number, tMs: number): number {
    const t = tMs / 1000;
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.tPrev);
    const dx = (x - this.xPrev) / dt;
    const edx = this.expSmooth(this.dxPrev, dx, this.alpha(dt, this.dCutoff));
    this.dxPrev = edx;
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const xHat = this.expSmooth(this.xPrev, x, this.alpha(dt, cutoff));
    this.xPrev = xHat;
    this.tPrev = t;
    return xHat;
  }

  private alpha(dt: number, cutoff: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  private expSmooth(prev: number, x: number, a: number): number {
    return a * x + (1 - a) * prev;
  }
}

/** Small sliding median kills single-frame webcam spikes before One Euro. */
export class MedianWindow2D {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly size: number;

  constructor(size = 5) {
    this.size = Math.max(3, size | 1); // odd
  }

  reset(): void {
    this.xs.length = 0;
    this.ys.length = 0;
  }

  push(x: number, y: number): { x: number; y: number } {
    this.xs.push(x);
    this.ys.push(y);
    if (this.xs.length > this.size) {
      this.xs.shift();
      this.ys.shift();
    }
    return { x: median(this.xs), y: median(this.ys) };
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
}

export class OneEuroFilter2D {
  private readonly fx: OneEuroFilter1D;
  private readonly fy: OneEuroFilter1D;

  /** Defaults biased toward stillness (reading), not fast games. */
  constructor(minCutoff = 0.55, beta = 0.007, dCutoff = 1.0) {
    this.fx = new OneEuroFilter1D(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter1D(minCutoff, beta, dCutoff);
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }

  filter(x: number, y: number, tMs = performance.now()): { x: number; y: number } {
    return {
      x: this.fx.filter(x, tMs),
      y: this.fy.filter(y, tMs),
    };
  }
}
