export type Point = { x: number; y: number };

export type EngineStatus =
  | "idle"
  | "loading"
  | "needs-permission"
  | "ready"
  | "calibrating"
  | "tracking"
  | "error";

export type GazeFrame = {
  raw: Point | null;
  filtered: Point | null;
  /** 0–1 rough confidence from recent stability + face presence. */
  confidence: number;
  faceDetected: boolean;
  speed: number;
};

export type CalibrationPoint = {
  id: number;
  nx: number;
  ny: number;
};
