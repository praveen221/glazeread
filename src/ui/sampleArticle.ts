/** Long-form sample so you can actually test reading, not a hello-world stub. */
export const sampleArticleHtml = `
<article class="article">
  <header class="article-header">
    <p class="eyebrow">Glaze max demo · WebGazer stack</p>
    <h1>Reading in the age of infinite text</h1>
    <p class="lede">
      This build is the accuracy-maxed demo: WebGazer’s eye-patch ridge model,
      dense calibration, click-to-correct learning, One Euro smoothing, spotlight
      focus, and a magnetic guide line. Use it hard. Break it. Tell us what still feels off.
    </p>
  </header>

  <h2>What is tracking your eyes now</h2>
  <p>
    Not a toy iris-to-screen guess alone. Glaze now rides on WebGazer — an open
    research system from Brown HCI that has been refined for years for exactly
    this problem: map webcam eye appearance to screen coordinates while you use
    the page.
  </p>
  <p>
    Under the hood it crops eye patches from a MediaPipe FaceMesh, feeds a ridge
    regression that learns from your calibration and clicks, applies a Kalman
    filter, then we run a One Euro filter so the point is calm when you read and
    responsive when you jump paragraphs.
  </p>
  <ul>
    <li>WebGazer.js — open source gaze estimation (GPL-3.0)</li>
    <li>MediaPipe FaceMesh eye patches via TF.js (on-device)</li>
    <li>19-point guided calibration + validation error score</li>
    <li>Click-to-correct continuous learning while you read</li>
    <li>Spotlight, soft 3D zoom, comet trail, lock meter</li>
  </ul>

  <h2>How to get a crazy demo take</h2>
  <p>
    Front light on your face, laptop centered, head roughly still for the first
    minute. Hit Start camera, then Full calibrate. Stare at the center of every
    pulse — do not only glance. After validation, read this article top to bottom.
  </p>
  <p>
    While reading, click a word you are actually looking at. Every click teaches
    the model. Hold Shift and click to teach without activating links. If drift
    creeps in after you move, press C and recalibrate in under a minute.
  </p>
  <p>
    Watch the lock meter in the corner. When it is high and the guide line sits
    under the line you are reading, the demo is working. When it lags or sticks
    to the wrong block, that is the bug report we want.
  </p>

  <h2>Why this can still fail</h2>
  <p>
    Webcam gaze is not a Tobii bar. Extreme angles, heavy backlight, reflective
    glasses, and huge posture changes still hurt. The maxed demo is the best we
    can do without dedicated hardware — not a promise of lab-grade precision.
  </p>
  <p>
    If accuracy is still low after a careful calibration, try again with the
    gaze trail on so you can see lag versus bias. Bias (always a few centimeters
    left) is fixable with more clicks. Pure noise means lighting or face mesh
    tracking is struggling.
  </p>
  <blockquote>
    Generation got optimized. Consumption is the open surface. This page is the
    stress test for an attention layer that never rewrites your text.
  </blockquote>

  <h2>Read this like a long model answer</h2>
  <p>
    Knowledge work now includes long synthesis chains. A researcher pastes three
    papers into a model and asks for contradictions. A PM pastes a customer call
    transcript and asks for risks. An engineer pastes a stack trace, a related
    PR, and a design doc. Each workflow produces text that looks authoritative
    and often is only partly right.
  </p>
  <p>
    The reading task is not only speed — it is selective trust. You need to know
    where you are in the argument when you look up and when you look back down.
    Traditional reader modes declutter chrome. Bionic bolding helps some people
    lock onto word onsets. Glaze sits in a different slot: an attention layer.
  </p>
  <p>
    Keep going. Jump back to the list of stack pieces. Look at the blockquote.
    Look at this paragraph again. Those transitions are where saccade handling
    and dwell thresholds show their quality. If zoom fights you, lower it. If
    the spotlight feels cinematic but heavy, toggle it off — the guide line alone
    is often enough.
  </p>
  <p>
    When the first five minutes feel inevitable — camera, calibrate, read —
    the category starts to exist. Until then, every jitter is a product clue.
    Leave Glaze on for the rest of this article and decide honestly whether you
    would keep it for an afternoon of AI-heavy work.
  </p>

  <h2>Closing loop</h2>
  <p>
    This is the maxed browser demo before a real extension. Same privacy rule:
    frames stay local. Same product rule: never rewrite the source. The only
    thing that should feel different is how easy it is to stay inside the line
    you mean to read.
  </p>
  <p>
    If this sentence is under a green rail right now, and the paragraph feels
    slightly lifted, the demo landed. If not, recalibrate once more — then send
    ruthless feedback.
  </p>
</article>
`;
