# Glaze

**Gaze-guided reading. Local. No rewrite.**

The Wispr Flow of consumption — a demo that tracks your gaze, soft-zooms the active paragraph, and floats a guide line under the line you are reading.

## Max demo stack (accuracy)

| Layer | What |
|--------|------|
| **WebGazer.js** | Open-source webcam → screen gaze (Brown HCI, GPL-3.0) |
| **MediaPipe FaceMesh** | Eye patches via TF.js, on-device |
| **Ridge regression + Kalman** | Built into WebGazer; learns from calibration & clicks |
| **One Euro filter** | Extra smoothing (stable when still, fast on jumps) |
| **19-point calibration** | Dense grid + validation error |
| **Click-to-correct** | Keep teaching while you read (Shift+click always teaches) |

Previous v0 used a thin custom iris-feature → screen regression on MediaPipe landmarks. That was too weak for a real demo. This build uses a real gaze pipeline.

## Run

```bash
npm install
npm run dev
```

## Record a session

Paste the text you will read and press **Use this text**. Then press **Record** (or `R`), then **Full calibrate**, then read in this window. The take is written to `data/sessions/<id>/` on this machine: webcam, microphone, gaze, eye landmarks, the line under your eyes, and where the window sat on the desktop. Stop ends the take and writes `examples.jsonl`, the joined training table. `npm run measure` prints every take. See [docs/LOOP.md](docs/LOOP.md).

Open `http://127.0.0.1:5173` (localhost required for camera).

### Demo path

1. **Start camera**
2. **Full calibrate** — stare at each pulsing target (head fairly still, face lit from the front)
3. Read the sample article
4. **Click where you are looking** to refine; **Shift+click** teaches without navigation
5. Optional: Pointer mode tests overlay feel without gaze

### Shortcuts

| Key | Action |
|-----|--------|
| `G` | Toggle Glaze |
| `C` | Recalibrate |

## Privacy

- Webcam frames stay in the browser tab
- No account, no cloud vision, no content rewrite
- FaceMesh WASM/model files are served locally from `public/mediapipe/`

## License

- **Glaze UI / overlay code:** [MIT](./LICENSE)
- **WebGazer.js:** GPL-3.0-or-later (dependency). If you distribute a combined build, comply with GPL for that stack.
