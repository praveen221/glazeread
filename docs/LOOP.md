# Measurement loop

A session is one take. You press Record, read, press Stop. The folder under `data/sessions/` is the raw material for the reading memory: where your eyes were, what the camera saw, what you said, and the exact line on screen, already aligned.

Nothing here uploads. The folder layout is the same shape an S3 prefix will use later (`raw/v1/YYYY/MM/DD/<session_id>/`). Copying a closed folder up is the whole migration. There is no uploader in this tree.

Record exists only while `npm run dev` is running. The dev server is the writer. A built preview has no save route.

## Morning

```bash
npm run dev
```

Open the local page on the monitor the webcam faces. Paste the text you will actually read and press **Use this text** before Record. A blank line starts a paragraph. The sample article is what gets saved if you skip that.

Press **Record**. Allow the camera and the microphone. Then run **Full calibrate**. Calibration clicks are written only while a take is already running. Read in this window. `Space` when you finish a paragraph. Shift-click when the dot is on the wrong line. Press **Stop**.

Gaze x and y are this window, not the whole desktop. Text on another monitor or in another app is not in the take. Glances there show up as Away, which is useful, but the words do not. `manifest.screen` and `events.jsonl` rows of type `screen` store where this window sat (`window_x` / `window_y`, the display size, and Chrome's `avail_left` / `avail_top` when the browser has them). Dragging the window onto the other monitor writes a new `screen` row. Adding `window_x` to a gaze x places that point on the desktop. A physical tilt of the panel is not in the browser. A photo of the desk is the angle record.

Then:

```bash
npm run measure
```

That prints one line per closed take: duration, gaze rows, fraction of those rows that landed on a real line of text, eye samples, teach/confirm labels, and file sizes.

To rebuild the training table from a folder you already have:

```bash
npm run join -- data/sessions/<session_id>
```

Stop already does this. Run join again after you add a transcript file later; it only rewrites `examples.jsonl` and returns a summary. It does not delete raw streams.

## Clock

`t0` is the moment Record is pressed.

- `t_ms` on every JSONL row is milliseconds since `t0` (`performance.now()`).
- `manifest.t0_wall_ms` is `Date.now()` at that same moment. Wall time of a row is `t0_wall_ms + t_ms`.
- `camera.webm` and `voice.webm` start a little later. The first line of `media.jsonl` for each stream is that start offset. Playback time `0` in the file equals that row's `t_ms`.

Gaze, eyes, reading, and events share `t_ms` directly. Media joins through `media.jsonl`.

## Folder

```
data/sessions/
  index.jsonl                 one row per closed take
  2026-09-25T08-12-03_ab12/
    manifest.json             identity, clock, device, status, summary
    content.json              every readable block, full text, stable id
    gaze.jsonl                screen gaze at tracker rate
    eyes.jsonl                eye contour in the webcam frame, 10 Hz
    reading.jsonl             line under the eyes, 4 Hz, plus a 1 Hz viewport
    events.jsonl              record, state, scroll, teach, confirm, calibration
    media.jsonl               chunk time and size for the webm files
    camera.webm               what the webcam saw
    voice.webm                microphone
    examples.jsonl            written on Stop; one training row per gaze sample
```

`data/` is gitignored. A crash before Stop leaves `manifest.status = "open"` and whatever chunks already landed. The JSONL flushes about once a second. Video arrives in about one-second clusters.

## Rows

Schema id: `glaze.session.v1`.

`content.json`

```json
{ "schema": "glaze.session.v1", "blocks": [{ "id": "b0003", "tag": "p", "text": "...", "text_hash": "a1b2c3d4" }] }
```

Ids are assigned in DOM order for that take (`b0000`…). `text_hash` is FNV-1a 32-bit hex of the flattened block text.

`gaze.jsonl` — one sample per tracker callback. `raw` is WebGazer before the reading filter. `filtered` is the point the overlay uses. `source` is `webgazer` or `pointer`. `block_id` / `line_text` are the block and visual line under that point at that same `t_ms` (not the zoom the overlay may still be easing toward).

```json
{"t_ms":1200,"raw":{"x":410,"y":320},"filtered":{"x":408,"y":318},"confidence":0.8,"face":true,"speed":4.2,"state":"READING","source":"webgazer"}
```

`eyes.jsonl` — at most 10 Hz, and only when FaceMesh has a 468-point mesh. `left` and `right` are `[x, y]` in webcam pixels. Order is fixed: upper lid, then lower lid, subject's left then subject's right. The index lists live in `src/record/eyeLandmarks.ts` (`LEFT_EYE_INDICES`, `RIGHT_EYE_INDICES`).

`reading.jsonl`

- `kind: "focus"` when the attention state, block, or line index changed. `kind: "tick"` otherwise. Both are 4 Hz.
- `line_text` is the words on that visual line, from glyph boxes, not from a line-height guess. Empty string means the fallback band was used and the words could not be sliced.
- `kind: "viewport"` about once a second: ids and rectangles of blocks on screen. Full text stays in `content.json`.

`events.jsonl` types: `record_start`, `record_stop`, `state`, `scroll`, `resize`, `visibility`, `screen`, `teach`, `confirm`, `calibration`.

`screen` is written once when the take starts and again whenever the window's display placement changes. Fields match `manifest.screen`: `w`, `h`, `avail_w`, `avail_h`, `window_x`, `window_y`, `outer_w`, `outer_h`, `avail_left`, `avail_top`, `is_extended`, `orientation`, `orientation_angle`.

`teach` is a strong screen label (you clicked where you were looking). `confirm` is a strong block label (`Space` on the paragraph you finished) plus the block's train point.

## Training row

`examples.jsonl` is `glaze.example.v1`. Stop builds it. One row per gaze sample.

| Field | Rule |
| --- | --- |
| `gaze` | `filtered` from that gaze row. This is the model's current guess, not ground truth. |
| `line_text`, `block_id`, `line_index` | Taken from the gaze row when that sample already has them. Otherwise hold the latest `reading.jsonl` row with `kind` `tick` or `focus` and `t_ms <=` this sample. |
| `eyes` | Nearest `eyes.jsonl` row within 150 ms. Otherwise null. |
| `strong` | A `teach` or `confirm` labels only the single nearest gaze row within 400 ms. Other rows stay null. |

`strong.kind = "teach"` is the xy to train against. `strong.kind = "confirm"` is the block you said you finished. `line_coverage` in the summary is the fraction of gaze rows that held a non-empty `line_text`. That is the number to watch. If it stays low, the take did not see the text, and a fancier model will not invent the missing join.

`state_ms` is how long gaze samples spent in Reading, Searching, Away, and Hesitating. Away time is supposed to be in the log and is supposed to be excluded from line labels you trust.

## What improves the memory

The memory is a personal map from eye appearance to the line you were on. This loop stores both sides.

- Appearance: `camera.webm` plus `eyes.jsonl` (contours in the frame the video shows).
- Place: `gaze.jsonl` for the current estimate, `reading.jsonl` for the line, `events.jsonl` `teach` and `confirm` for the points you explicitly marked.
- Speech: `voice.webm`, same clock, so a later transcript can become more labels. The reserved shape is `voice.transcript.jsonl` with `{ "t_ms", "t_end_ms", "text" }`. Nothing writes that file yet. Drop it in the session folder when you have one; join does not read it until that step is added.
- The page, exactly: `content.json` and the viewport rows. You can reconstruct which words were on screen without a screen recording.

A useful take has a live camera, a live mic, `line_coverage` well above zero while you were actually reading, and a handful of `teach` or `confirm` events. `npm run measure` is the check before you trust the folder.

## Failure

If a chunk cannot be saved after three tries, Record stops itself and still tries to close the folder. `manifest.fault` and the index row carry the message. A faulted take is partial. Do not train on it as if it were complete.

Microphone denial does not cancel the take. `manifest.voice` is `denied`, and the status line says so. Gaze, camera, and text still record.

Pointer mode (no camera) records the pointer as `source: "pointer"`, skips the webcam file, and still records the mic and the text. Those rows are not eye data. Filter them out before any gaze fit.

## S3, later

Closed folder, unchanged:

```
s3://<bucket>/raw/v1/YYYY/MM/DD/<session_id>/manifest.json
s3://<bucket>/raw/v1/YYYY/MM/DD/<session_id>/gaze.jsonl
...
```

`manifest.storage.s3_key_prefix` is that prefix. `storage.backend` stays `"local"` until an uploader exists. Do not point the browser at a bucket. The dev server, or a later copy step, is the only writer.
