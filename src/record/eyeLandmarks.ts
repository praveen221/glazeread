import type { EyeLandmarks } from "./schema";
import { round1 } from "./schema";

/**
 * MediaPipe FaceMesh eye contours, subject's left then right.
 * Upper lid, then lower lid. Same order WebGazer uses to cut eye patches.
 * 468-point mesh (no iris refinement).
 */
export const LEFT_EYE_INDICES = [
  466, 388, 387, 386, 385, 384, 398, 263, 249, 390, 373, 374, 380, 381, 382, 362,
] as const;

export const RIGHT_EYE_INDICES = [
  246, 161, 160, 159, 158, 157, 173, 33, 7, 163, 144, 145, 153, 154, 155, 133,
] as const;

export function eyeLandmarks(
  positions: number[][],
  videoW: number,
  videoH: number,
): EyeLandmarks | null {
  const left = take(positions, LEFT_EYE_INDICES);
  const right = take(positions, RIGHT_EYE_INDICES);
  if (!left || !right) return null;
  return { video_w: videoW, video_h: videoH, left, right };
}

function take(positions: number[][], indices: readonly number[]): [number, number][] | null {
  const out: [number, number][] = [];
  for (const index of indices) {
    const point = positions[index];
    if (!point) return null;
    const x = point[0];
    const y = point[1];
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push([round1(x), round1(y)]);
  }
  return out;
}
