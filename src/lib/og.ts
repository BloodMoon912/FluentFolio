// Zero-dependency Open Graph image generator. Renders a 1200x630 SVG card
// server-side (no headless browser / rasterizer needed) so it works as-is
// on Cloudflare Workers. Facebook, Slack and Discord unfurl SVG og:image
// fine; X/Twitter's card validator does not, so if pixel-perfect Twitter
// cards matter later, swap this out for a satori + resvg-wasm PNG renderer
// using the same layout.

const CJK_RANGE = /[\u3400-\u9fff\uf900-\ufaff]/;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function charWidth(ch: string, fontSize: number): number {
  return CJK_RANGE.test(ch) ? fontSize : fontSize * 0.56;
}

function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(current);
      current = '';
      currentWidth = 0;
      continue;
    }
    const w = charWidth(ch, fontSize);
    if (currentWidth + w > maxWidth && current) {
      lines.push(current);
      current = ch;
      currentWidth = w;
      if (lines.length === maxLines) break;
    } else {
      current += ch;
      currentWidth += w;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : last;
  }
  return lines;
}

export type OgCardInput = {
  eyebrow: string;
  title: string;
  meta: string;
  brand: string;
};

export function renderOgSvg({ eyebrow, title, meta, brand }: OgCardInput): string {
  const width = 1200;
  const height = 630;
  const fontSize = 62;
  const lineHeight = 72;
  const lines = wrapText(title, 1000, fontSize, 3);
  const titleTop = 250;
  const titleTspans = lines
    .map((line, i) => `<tspan x="90" y="${titleTop + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  // `Noto Sans TC` comes first so the PNG pipeline (which only loads the
  // subsetted copy of that family) selects it deterministically instead of
  // relying on a font-family fallback. Browsers viewing the SVG keep their own
  // fallbacks for the families they do have installed.
  const fontFamily = "'Noto Sans TC','Segoe UI',Arial,sans-serif";
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14161c"/>
      <stop offset="1" stop-color="#0a0b0f"/>
    </linearGradient>
    <radialGradient id="glow" cx="88%" cy="6%" r="55%">
      <stop offset="0" stop-color="#f7cfe2" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#f7cfe2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#23262e" stroke-width="2"/>
  ${eyebrow ? `<text x="90" y="150" font-family="${fontFamily}" font-size="26" letter-spacing="5" fill="#f2a8c6" font-weight="700">${escapeXml(eyebrow.toUpperCase())}</text>` : ''}
  <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="700" fill="#f5f5f7">${titleTspans}</text>
  <text x="90" y="562" font-family="${fontFamily}" font-size="24" fill="#9a9da6">${escapeXml(meta)}</text>
  <text x="${width - 90}" y="562" text-anchor="end" font-family="${fontFamily}" font-size="24" font-weight="700" fill="#f5f5f7">${escapeXml(brand)}</text>
</svg>`;
}
