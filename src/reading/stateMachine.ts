import type { Point } from "../gaze/types";

/** First-class reading attention states. */
export type ReadingState = "READING" | "SEARCHING" | "AWAY" | "HESITATING";

export type StateInput = {
  now: number;
  gaze: Point | null;
  /** px/frame-ish after filtering. */
  speed: number;
  confidence: number;
  faceDetected: boolean;
  /** Hit a readable block under gaze. */
  onReadable: boolean;
  /** Same active paragraph as last tick. */
  sameParagraph: boolean;
  /** Viewport size for off-screen checks. */
  viewport: { w: number; h: number };
};

export type StateSnapshot = {
  state: ReadingState;
  /** True when overlay must not thrash focus/guide. */
  freeze: boolean;
  /** True when click/space labels should be accepted. */
  acceptTrain: boolean;
  reason: string;
  since: number;
};

const AWAY_MARGIN = 48;
const SEARCH_SPEED = 42;
const HESITATE_MS = 900;
const AWAY_CONFIRM_MS = 180;
const RETURN_MS = 120;

/**
 * Attention state machine for reading.
 * LOOKING_AWAY / search / dwell → product feels intentional instead of epileptic.
 */
export class ReadingStateMachine {
  private state: ReadingState = "AWAY";
  private since = performance.now();
  private candidate: ReadingState | null = null;
  private candidateSince = 0;
  private dwellOnBlockSince = 0;
  private lastOnReadable = false;

  get(): StateSnapshot {
    return {
      state: this.state,
      freeze: this.state === "AWAY" || this.state === "SEARCHING",
      acceptTrain: this.state === "READING" || this.state === "HESITATING",
      reason: this.reasonFor(this.state),
      since: this.since,
    };
  }

  reset(): void {
    this.state = "AWAY";
    this.since = performance.now();
    this.candidate = null;
    this.candidateSince = 0;
    this.dwellOnBlockSince = 0;
    this.lastOnReadable = false;
  }

  update(input: StateInput): StateSnapshot {
    const desired = this.classify(input);
    const now = input.now;

    // Hysteresis: require short confirm before leaving READING into AWAY,
    // and before leaving AWAY back into READING.
    if (desired !== this.state) {
      if (this.candidate !== desired) {
        this.candidate = desired;
        this.candidateSince = now;
      }
      const need =
        this.state === "READING" && desired === "AWAY"
          ? AWAY_CONFIRM_MS
          : this.state === "AWAY" && (desired === "READING" || desired === "SEARCHING")
            ? RETURN_MS
            : desired === "SEARCHING"
              ? 40
              : 100;
      if (now - this.candidateSince >= need) {
        this.state = desired;
        this.since = now;
        this.candidate = null;
      }
    } else {
      this.candidate = null;
    }

    return this.get();
  }

  private classify(input: StateInput): ReadingState {
    const { gaze, speed, confidence, faceDetected, onReadable, sameParagraph, viewport, now } =
      input;

    if (!faceDetected || !gaze || confidence < 0.22) {
      return "AWAY";
    }

    const off =
      gaze.x < -AWAY_MARGIN ||
      gaze.y < -AWAY_MARGIN ||
      gaze.x > viewport.w + AWAY_MARGIN ||
      gaze.y > viewport.h + AWAY_MARGIN;
    if (off) return "AWAY";

    if (speed >= SEARCH_SPEED) {
      this.dwellOnBlockSince = 0;
      this.lastOnReadable = false;
      return "SEARCHING";
    }

    if (!onReadable) {
      this.dwellOnBlockSince = 0;
      this.lastOnReadable = false;
      // Eyes on chrome/sidebar — treat as soft away (freeze), not search thrash.
      return "AWAY";
    }

    if (!this.lastOnReadable || !sameParagraph) {
      this.dwellOnBlockSince = now;
      this.lastOnReadable = true;
    }

    const dwell = now - this.dwellOnBlockSince;
    if (dwell >= HESITATE_MS && speed < 12) {
      return "HESITATING";
    }

    return "READING";
  }

  private reasonFor(s: ReadingState): string {
    switch (s) {
      case "READING":
        return "stable on text";
      case "SEARCHING":
        return "fast eye motion";
      case "AWAY":
        return "look-away / off page";
      case "HESITATING":
        return "long dwell";
    }
  }
}
