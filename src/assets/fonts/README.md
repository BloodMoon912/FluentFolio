# Open Graph card fonts

The prerendered OG cards (`/og.png`, `/og/[slug].png`) are rasterised by
`@resvg/resvg-js` with `loadSystemFonts: false`, so the only font it can use is
the subsetted copy in this directory. That is what makes the PNG identical on a
developer machine and in CI.

## Noto Sans TC, subset

- Family: **Noto Sans TC** (SIL Open Font License 1.1, see [`OFL.txt`](OFL.txt)).
- Upstream: <https://github.com/google/fonts/tree/main/ofl/notosanstc>
  (`NotoSansTC[wght].ttf`, a variable font).
- Committed files:
  - `NotoSansTC-Regular.subset.ttf` (400, ~347 KB)
  - `NotoSansTC-Bold.subset.ttf` (700, ~347 KB)
  - together well under the 2 MB budget.
- No WOFF2: `@resvg/resvg-js` 2.6.2 silently renders no text at all when it is
  handed a WOFF2 font, so the subsets stay as plain TrueType.

The subset covers every character in this repository's `src/**` text (content,
i18n dictionaries, data and page literals) plus printable ASCII, Latin-1,
general punctuation, CJK punctuation and fullwidth forms. New content written
with a character outside the subset would render as a placeholder; the build
logs a warning naming the missing characters (`[og] The subsetted OG font has
no glyph for: …`) and the fix is to re-run the subset step below.

## Regenerating the subsets

Requires [uv](https://docs.astral.sh/uv/) (for `fonttools`) and network access.

1. Download the upstream variable font and its licence into a scratch
   directory.

   ```bash
   curl -L -o NotoSansTC-VF.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
   curl -L -o OFL.txt "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/OFL.txt"
   ```

2. Build the character set (run from the repository root).

   ```bash
   python - <<'PY'
   import pathlib

   repo = pathlib.Path('.')
   chars = set()
   for start, end in [(0x20, 0x7E), (0xA0, 0xFF), (0x2000, 0x206F), (0x20AC, 0x20AC), (0x2190, 0x21FF), (0x3000, 0x303F), (0xFF00, 0xFFEF)]:
       chars.update(chr(cp) for cp in range(start, end + 1))
   for pattern in ['src/**/*.md', 'src/**/*.astro', 'src/**/*.ts', 'src/**/*.mjs', 'src/**/*.json']:
       for path in repo.glob(pattern):
           if path.is_file():
               chars.update(path.read_text(encoding='utf-8'))
   pathlib.Path('chars.txt').write_text(''.join(sorted(chars)), encoding='utf-8')
   print(f'{len(chars)} characters')
   PY
   ```

3. Instantiate the two static weights (the variable font's default instance is
   Thin, so the name table must be updated) and subset each one.

   ```bash
   uvx --from fonttools fonttools varLib.instancer --update-name-table NotoSansTC-VF.ttf wght=400 -o NotoSansTC-Regular.ttf
   uvx --from fonttools fonttools varLib.instancer --update-name-table NotoSansTC-VF.ttf wght=700 -o NotoSansTC-Bold.ttf

   for weight in Regular Bold; do
     uvx --from "fonttools[woff]" pyftsubset "NotoSansTC-$weight.ttf" \
       --text-file=chars.txt \
       --output-file="NotoSansTC-$weight.subset.ttf" \
       --layout-features='*' --glyph-names --symbol-cmap --legacy-cmap \
       --notdef-glyph --notdef-outline --recommended-glyphs \
       --name-IDs='*' --name-legacy --name-languages='*'
   done
   ```

4. Copy `NotoSansTC-Regular.subset.ttf`, `NotoSansTC-Bold.subset.ttf` and
   `OFL.txt` back here, then run `node scripts/check-og-png.mjs` after a build.
