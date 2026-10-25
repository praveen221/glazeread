export type Box = { x: number; y: number; w: number; h: number };

export type LineHit = {
  index: number;
  count: number;
  text: string;
  rect: Box;
  lineHeight: number;
};

type WordBox = { text: string; x: number; y: number; w: number; h: number };

/**
 * The line of `el` under a viewport Y, using real glyph boxes.
 * Falls back to line-height bands when the block has no measurable words.
 */
const lineCache = new WeakMap<HTMLElement, { key: string; lines: { index: number; text: string; rect: Box }[] }>();

export function lineAtPoint(el: HTMLElement, clientY: number): LineHit | null {
  const lines = cachedWordLines(el);
  if (lines.length) {
    let containing: { index: number; text: string; rect: Box } | null = null;
    let nearest = lines[0];
    let nearestDist = Infinity;
    for (const line of lines) {
      const top = line.rect.y;
      const bottom = line.rect.y + line.rect.h;
      if (clientY >= top - 1 && clientY <= bottom + 1) {
        containing = line;
        break;
      }
      const dist = Math.abs(clientY - (top + line.rect.h / 2));
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = line;
      }
    }
    const picked = containing ?? nearest;
    if (!picked) return null;
    return {
      index: picked.index,
      count: lines.length,
      text: picked.text,
      rect: picked.rect,
      lineHeight: picked.rect.h,
    };
  }
  return bandFallback(el, clientY);
}

function bandFallback(el: HTMLElement, clientY: number): LineHit | null {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0 || rect.width <= 0) return null;
  const style = getComputedStyle(el);
  let lineHeight = parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    lineHeight = (parseFloat(style.fontSize) || 16) * 1.45;
  }
  const count = Math.max(1, Math.round(rect.height / lineHeight));
  const rel = Math.min(Math.max(clientY - rect.top, 0), Math.max(0, rect.height - 1));
  const index = Math.min(count - 1, Math.floor(rel / lineHeight));
  return {
    index,
    count,
    text: "",
    rect: {
      x: rect.left,
      y: rect.top + index * lineHeight,
      w: rect.width,
      h: lineHeight,
    },
    lineHeight,
  };
}

function cachedWordLines(el: HTMLElement): { index: number; text: string; rect: Box }[] {
  const rect = el.getBoundingClientRect();
  const key = [
    window.scrollY,
    window.innerWidth,
    el.textContent?.length ?? 0,
    Math.round(rect.height),
    Math.round(rect.top),
  ].join("|");
  const cached = lineCache.get(el);
  if (cached && cached.key === key) return cached.lines;
  const lines = wordLines(el);
  lineCache.set(el, { key, lines });
  return lines;
}

function wordLines(el: HTMLElement): { index: number; text: string; rect: Box }[] {
  const words = collectWords(el);
  if (!words.length) return [];

  words.sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: WordBox[][] = [];
  for (const word of words) {
    const current = groups[groups.length - 1];
    if (!current) {
      groups.push([word]);
      continue;
    }
    const anchor = current[0];
    if (!anchor) {
      groups.push([word]);
      continue;
    }
    const sameLine =
      Math.abs(word.y + word.h / 2 - (anchor.y + anchor.h / 2)) <=
      Math.max(4, anchor.h * 0.65);
    if (sameLine) current.push(word);
    else groups.push([word]);
  }

  return groups.map((group, index) => {
    group.sort((a, b) => a.x - b.x);
    const left = Math.min(...group.map((w) => w.x));
    const top = Math.min(...group.map((w) => w.y));
    const right = Math.max(...group.map((w) => w.x + w.w));
    const bottom = Math.max(...group.map((w) => w.y + w.h));
    return {
      index,
      text: group.map((w) => w.text).join(" "),
      rect: { x: left, y: top, w: right - left, h: bottom - top },
    };
  });
}

function visualText(text: string, transform: string): string {
  if (transform === "uppercase") return text.toLocaleUpperCase();
  if (transform === "lowercase") return text.toLocaleLowerCase();
  if (transform === "capitalize") {
    return text.replace(/\S+/g, (word) => word.charAt(0).toLocaleUpperCase() + word.slice(1));
  }
  return text;
}

function collectWords(el: HTMLElement): WordBox[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const words: WordBox[] = [];
  let node = walker.nextNode();
  while (node) {
    const raw = node.textContent ?? "";
    const styled = node.parentElement ?? el;
    const transform = getComputedStyle(styled).textTransform;
    const re = /\S+/g;
    let match = re.exec(raw);
    while (match) {
      if (words.length > 800) return words;
      const start = match.index;
      const end = start + match[0].length;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const rect = range.getClientRects()[0];
      range.detach();
      if (rect && rect.width > 0 && rect.height > 0) {
        words.push({
          text: visualText(match[0], transform),
          x: rect.left,
          y: rect.top,
          w: rect.width,
          h: rect.height,
        });
      }
      match = re.exec(raw);
    }
    node = walker.nextNode();
  }
  return words;
}
