# Glaze — stronger plan

## What we shipped today (be precise)

| Piece | Source | Role |
|--------|--------|------|
| **WebGazer.js** | Brown HCI, open source (GPL-3.0) | Webcam → screen gaze via eye-patch features + ridge regression |
| **MediaPipe FaceMesh** | Google, via TF.js inside WebGazer | Find face/eyes in the camera frame |
| **Kalman filter** | Inside WebGazer | First stage of prediction smoothing |
| **Median window + One Euro** | Our code | Kill spikes; keep point calm while reading |
| **Calibration + click-to-teach** | Our code | Map *your* eyes to *this* screen |
| **Overlay** | Our code | Zoom, guide, spotlight, freeze on instability |

We did **not** invent a medical-grade eye tracker. We assembled the best **browser + webcam** stack that is realistic for an open demo, then wrapped it in a reading UI.

---

## What low-vision / accessibility systems actually use

They are **not** primarily on WebGazer-class webcam tracking for production reading aids.

### Research (closest to “gaze helps reading”)

- **GazePrompt (CHI 2024)** — gaze-aware line highlight + word help for low vision  
  - Hardware: **Tobii Pro Fusion (120 Hz)** bar on the monitor  
  - Logic: detect **hesitation**, **line switch intent**, then magnify / TTS  
  - Not continuous zoom-everything; **behavior-triggered** help

- Classic **gaze-contingent magnification** papers — almost always **Tobii / EyeLink / SMI** lab trackers

### Products people with motor / vision needs actually buy

| Tier | Examples | Accuracy | Notes |
|------|----------|----------|--------|
| **Screen bar** | Tobii Eye Tracker 5, Tobii Pro Nano/Fusion, GazePoint | High | Infrared + cameras under the display |
| **OS / AAC** | Windows Eye Control, Tobii Dynavox, EyeGaze Edge | High | Often for **click / dwell typing**, not “AI reading layer” |
| **Phone / AR** | Apple accessibility, XR headsets with eye cameras | Medium–high | Device-bound |
| **Webcam research** | WebGazer, SeeSo-ish webcam APIs, various demos | Medium–low | Cheap, everywhere, noisy |

**Takeaway:** The serious accessibility line is **hardware eye tracking + smart reading behaviors** (line switch, hesitation, TTS). Webcam is the **wedge for knowledge workers**, not a replacement for Tobii in clinical settings.

Glaze’s product bet is different:  
**“AI text volume for people with normal vision who are drowning in words”** — using the laptop they already have. Same *family* of ideas as GazePrompt (attention-aware reading), different *user*, different *hardware ceiling*.

---

## Why you still feel noise / jitter

1. **Webcam SNR** — pupil/iris at ~30–60 Hz, bad light, compression  
2. **Head micro-motion** — ridge model confuses pose with gaze  
3. **No ground truth after cal** — one grid fit drifts as you slouch  
4. **Eyes leave the page constantly** — message, water, fan, blink → raw tracker still outputs garbage points  

Fixing (4) is as important as fixing (1). A reading product must **not treat every glance as “read this paragraph.”**

---

## The stronger product idea (your data loop)

Your instinct is right: **one static calibration is weak**. Reading is a *behavior over time*. The strong version of Glaze is a **personal reading model**, not a one-shot gaze → pixel map.

### Capture (local-first)

Opt-in **reading sessions** that store *on device*:

| Stream | What | Why |
|--------|------|-----|
| Webcam features | Eye patches / landmarks (not necessarily raw video forever) | Appearance → gaze |
| Screen context | Active app, paragraph IDs, scroll Y, font metrics | Where content is |
| Weak labels | Clicks, selection, scroll, keyboard | “I was here” |
| Optional strong labels | Short “read aloud this line” / highlight the line you finished | Ground truth |
| Events | Face lost, head turn, phone lift (if detectable) | Look-away |

**Do not** default to full screen video + full face video in the cloud. That is a privacy bomb and a shipping blocker. Prefer:

- Derived features (eye embeddings, gaze estimates)  
- DOM/structure of the reader surface  
- Session stays local; optional encrypted export later  

### Labels that beat “stare at dots”

1. **Natural click-to-correct** (already started)  
2. **Scroll + dwell alignment** — when you stop scrolling and dwell, bias gaze to visible mid-column  
3. **Read-along mode** — user presses `Space` when they finish a paragraph (cheap, powerful)  
4. **Periodic micro-cal** — 3 points every 15 min, not 19 points from cold  
5. **Later:** personal neural map trained on (features → line index), not only (features → x,y)

### Reading state machine (must exist)

```
LOOKING_AWAY  → freeze overlay, do not train, do not switch paragraph
SEARCHING     → eyes moving fast / scanning; guide only, no zoom thrash
READING       → stable dwell on a block; zoom + line rail
HESITATING    → long dwell on a word/region; optional future TTS / expand
BLINK/LOST    → hold last state 200–400ms, then LOOKING_AWAY
```

Your phone-message / drink-water problem is **LOOKING_AWAY**, not “bad calibration.” Treating look-away as a first-class state is how the product feels intentional instead of epileptic.

---

## Roadmap (build order)

### Phase A — Feel (now → 2 weeks)

- [x] WebGazer base + dense cal + click teach  
- [x] Slower calibration timing  
- [x] Median + One Euro + freeze on low confidence  
- [x] Explicit **READING / SEARCHING / AWAY / HESITATING** state machine + HUD chip  
- [x] **Space = I finished this paragraph** (mark done + train + advance)  
- [ ] Micro-cal (3 points) hotkey  
- [ ] Jitter metrics HUD (Hz, px RMS) so we can measure, not vibe  

### Phase B — Personal model (2–6 weeks)

- [ ] Local session store (IndexedDB): features + labels, no cloud  
- [ ] Train personal offset / residual model on top of WebGazer  
- [ ] Line-index predictor for the article column (often more useful than raw x,y)  
- [ ] Drift detector → prompt micro-cal when RMS spikes  

### Phase C — Real surfaces (parallel)

- [ ] Browser extension (ChatGPT, Claude, Notion, articles)  
- [ ] Per-site paragraph adapters  
- [ ] Optional **Tobii Eye Tracker 5** input path (same overlay, better signal)  

### Phase D — Optional “lab” mode (only if you want the research moat)

- [ ] Explicit consent flow for longer recordings  
- [ ] Screen + face **feature** capture for offline training  
- [ ] Publish anonymized benchmarks; do **not** make this the default product path  

### Phase E — Hardware honesty

- [ ] “Webcam mode” vs “Tracker mode” in UI  
- [ ] Partner path: Tobii / similar for power users who need silence-level stability  

---

## Decision rules

1. **Never thrash the page on look-away.** Freeze > wrong zoom.  
2. **Calibrate at reading pace**, not game pace.  
3. **Personal data stays local** until there is a clear, consented reason otherwise.  
4. **Measure jitter** (px RMS while user holds a target) every build.  
5. **Webcam is the wedge; IR tracker is the ceiling** — design the overlay for both.  
6. Content-side readability (shorter AI text, hierarchy) is complementary, not competition.

---

## Immediate next engineering bets (priority)

1. Reading state machine + away freeze (biggest “feels smart” jump)  
2. `Space` paragraph confirm + use as training label  
3. Micro-cal + continuous residual learning  
4. Extension on one AI chat surface  
5. Optional Tobii adapter for the “holy shit” demo with hardware  

That is the stronger plan: not “better dots,” but **a local system that learns how you read and knows when you stopped.**
