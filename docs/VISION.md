# Vision

AI optimized generation. Consumption is still wide open.

Glaze is the reading-side counterpart to tools like Wispr Flow on the input side: a lightweight, non-generative layer for attention — gaze tracking, paragraph focus zoom, and a floating guide line that follows the eyes.

## Demo stack

- **WebGazer.js** (open source) for webcam → screen gaze
- Dense calibration + click-to-correct learning
- On-device FaceMesh; no cloud vision in the core loop

Principles:

- No rewriting of content
- No LLM tokens required for the core loop
- Stay out of the way; enhance the page or reader surface
- Privacy-first gaze handling on-device where possible
