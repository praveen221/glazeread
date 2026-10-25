/** Turn pasted reading into article blocks. Blank lines separate paragraphs. */

const MAX_CHARS = 400_000;

export function loadReading(root: HTMLElement, raw: string): number {
  if (raw.length > MAX_CHARS) {
    throw new Error("That paste is too long for one take. Keep it under 400,000 characters.");
  }
  const article = articleFromText(raw);
  if (!article) throw new Error("Paste the text first.");
  const blocks = article.childElementCount;
  root.replaceChildren(article);
  return blocks;
}

function articleFromText(raw: string): HTMLElement | null {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return null;
  const hasBlank = /\n\s*\n/.test(normalized);
  const chunks = hasBlank ? normalized.split(/\n\s*\n/) : normalized.split("\n");
  const article = document.createElement("article");
  article.className = "article";
  for (const chunk of chunks) {
    const heading = headingOf(chunk);
    const text = heading ? heading.text : reflow(chunk);
    if (!text) continue;
    const el = document.createElement(heading ? heading.tag : "p");
    el.textContent = text;
    article.append(el);
  }
  return article.childElementCount > 0 ? article : null;
}

function headingOf(chunk: string): { tag: "h1" | "h2" | "h3"; text: string } | null {
  const line = chunk.trim();
  if (!line || line.includes("\n")) return null;
  if (line.startsWith("### ")) return { tag: "h3", text: line.slice(4).trim() };
  if (line.startsWith("## ")) return { tag: "h2", text: line.slice(3).trim() };
  if (line.startsWith("# ")) return { tag: "h1", text: line.slice(2).trim() };
  return null;
}

function reflow(chunk: string): string {
  return chunk.replace(/[ \t]*\n[ \t]*/g, " ").replace(/\s+/g, " ").trim();
}
