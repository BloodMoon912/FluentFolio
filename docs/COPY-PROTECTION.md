# Copy Protection and Licensing (COPY-PROTECTION)

This document records the **tiered** approach and the operating steps this site uses for "content being copied, reposted, or crawled at scale", for future maintenance and handover. All public commitments are governed by [`src/pages/terms.astro`](../src/pages/terms.astro) (`/terms`) and by the licence notices carried on each page; this document does not create any additional commitment.

These measures complement one another, but **they do not constitute any guarantee**: they can only raise the cost of copying, leave traceable clues, and give licensing and enforcement a basis. They cannot make content "uncopyable" or "fully protected" — any text delivered to a browser can technically be saved, and any public page can be retyped by hand. The capabilities actually available depend on the Cloudflare plan and on the dashboard as it stands at the time; the plan limits cited in this document are taken from official documentation with the access date noted, and anything that could not be verified is marked "unconfirmed".

The tiers are:

- **Deterrence**: copy protection (`src/lib/copy-protection.ts`), which adds friction to "straight copy-and-paste".
- **Attribution**: CC BY-NC-ND 4.0 in the footer, and the copyright and licensing statement on the terms page, giving the licence scope and attribution requirements an explicit basis.
- **Evidence**: watermark decoding, source files and commit records, and publication-time comparisons, for later comparison and complaints.
- **Legal**: licence requests, infringement notices, and platform complaint procedures.
- **Rate limiting**: Cloudflare WAF rate limiting rules that block high-frequency crawling within a short window.

## Summary of measures by tier

| Measure                       | Implementation location                                                                                                                                                        | Effective scope                                                                                                                              | What it blocks / does not block                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Copy protection + attribution | `src/lib/copy-protection.ts`, `public/scripts/copy-guard-core.js`, `public/scripts/copy-guard.js`, `src/styles/reading.css`, and `data-copy-protect` on the three detail pages | Novel, worldbuilding, and dictionary detail pages; can be overridden per entry via frontmatter `copyProtect`; blog is unprotected by default | Blocks: drag selection with the mouse, the context menu, and drag-and-drop. When a selection still contains protected text (for example in some browsers or assistive technology), the copied content is rewritten to at most 120 characters plus the attribution; actual reachability in Chromium is covered in the next section. Does not block: viewing source, reader mode, disabling JS, screenshot OCR, manual retyping. |
| Page notices and terms        | `src/pages/terms.astro`, `src/i18n/ui.ts`                                                                                                                                      | Site-wide; the "Copyright and licensing" section of `/terms`                                                                                 | States the licence scope and the quotation limit; this is a legal and communication layer, not a technical restriction.                                                                                                                                                                                                                                                                                                        |
| Invisible watermark           | `src/lib/watermark-core.mjs`, `src/lib/watermark-plugin.mjs`, `astro.config.mjs`, `scripts/decode-watermark.mjs`                                                               | Written at build time into the output HTML of novel, worldbuilding, and dictionary body text; the stored Markdown is not modified            | Provides "possible" provenance evidence: it can show that a paragraph on a page was copied. Does not block: zero-width characters can be stripped, and a few tools may display or read them aloud.                                                                                                                                                                                                                             |
| robots.txt tiers              | `src/lib/robots-txt.ts`, `src/pages/robots.txt.ts`, `src/lib/crawl-policy.ts`                                                                                                  | Crawlers that voluntarily honour robots.txt; search engines stay crawlable                                                                   | Blocks: compliant AI crawlers avoid the blocked paths. Does not block: crawlers that do not comply, forged User-Agents, content already fetched.                                                                                                                                                                                                                                                                               |
| WAF rate limiting             | Manually configured in the Cloudflare dashboard (template below in this document)                                                                                              | The three document prefixes; the rule must be created in the dashboard                                                                       | Blocks: high-frequency crawling from the same IP within a short window. Does not block: slow, distributed, or IP-rotating crawling.                                                                                                                                                                                                                                                                                            |
| Edge AI crawler policy        | Cloudflare dashboard **Security → Settings → filter Bot traffic → AI Crawler and Agent access policies**                                                                       | Site-wide; must be configured manually in the dashboard                                                                                      | Blocks verified AI crawlers and training use at the edge; of limited effect against unverified or disguised traffic. Details and plan limits are in `docs/CRAWLER-POLICY.md`.                                                                                                                                                                                                                                                  |

## Accessibility and UX trade-offs

- Body text is never removed from the DOM: there is no `aria-hidden`, no conversion to an image / canvas / pseudo-element, no interception of `selectstart`, no disabling of printing (`reading.css` has no `@media print` rule), and no interception of keyboard shortcuts.
- Actual effect of `user-select: none`: the mouse cannot select text inside a protected area (which is the point); screen readers, browser translation, and reader mode can still read the DOM text. In testing on Chromium, even `Ctrl+A` does not include protected body text in the selection, so for protected body text the main effect is "it cannot be selected", and the clipboard rewrite usually never fires. If some browsers or assistive technology still produce a selection containing protected text, the `copy` event handler rewrites it to 120 characters plus the attribution; that is defence in depth, not a path guaranteed to occur.
- When the selection falls entirely inside `[data-copy-allow]` (or a form control, or `[contenteditable]`), the `copy` handler does not intervene and the original copied content is kept; a selection that extends beyond that range is rewritten according to the protection rules.
- Text inside forms, inputs, `[contenteditable]`, and `[data-copy-allow]` stays selectable; blog pages are completely unaffected; the copy button on code blocks (`markdown-enhance.js`) uses its own clipboard path and is not rewritten by copy protection.
- No "summary copied" toast or live region was added: the project currently has no reusable non-blocking notification component, and to avoid adding a new component and new i18n keys this change only rewrites the clipboard content.
- Known cost: inside a protected area you cannot use mouse selection to "search for selected text" or to quote the text yourself; Chromium's keyboard select-all does not include protected body text either. When you need to quote, use reader mode, browser translation, or view the source directly.
- Not yet tested on real hardware: screen readers (NVDA / VoiceOver), Safari, Firefox. The browsers that were tested are listed in the next section.

## Verified items

| Date       | Environment                                                           | Operation                                                                                                                                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-08 | Chromium 1228 (Playwright, headless)                                  | Novel detail page: drag selection, context menu, drag-and-drop, programmatic selection across the protected area followed by copy, `Ctrl+A`, blog comparison, code copy button, Swup navigation, search box | Drag selection selected nothing; the context menu and drag-and-drop were blocked; a selection crossing the protected area was rewritten by the `copy` handler to 120 characters plus attribution (209 characters); `Ctrl+A` did not include protected body text in Chromium (reproduced separately in the same Chromium build); the blog could be copied normally, the code button worked, protection was still active after Swup navigation, and the console showed 0 errors. The script was not committed; re-running it requires your own Playwright script. |
| 2026-11-08 | Node 22.23.4                                                          | `node --test tests/copy-guard-core.test.ts`                                                                                                                                                                 | 6/6 passed (truncation, zero characters, CJK / line breaks, empty selection, custom licence, default title).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-11-08 | Node 22.23.4, `WATERMARK_SECRET=probe-secret`, temporary test entries | Inspect the output HTML after a build, and decode it with `scripts/decode-watermark.mjs`                                                                                                                    | Each of the 3 body texts had one 32-bit zero-width signature inserted; decoding reported `novel/<id>`; with no secret set the build succeeded and printed a skip warning.                                                                                                                                                                                                                                                                                                                                                                                       |

## Adjusting `COPY_MAX_CHARS`

- The constant lives in `src/lib/copy-protection.ts` and is currently `120`; `0` means no body text is retained at all and only the attribution is output.
- The three detail pages write the constant into `data-copy-max`, and `/terms` passes the same number through `data-i18n-args`, so the copy and the behaviour cannot disagree.
- After a change, run `npm run check`, `npm run check:public`, `npm test`, and `npm run build` in that order, and repeat the browser check.
- This number is an in-house policy reference value, not a legal boundary; do not write it up as "exceeding it is infringement" or anything of that sort.

## Per-entry overrides of `copyProtect` and `crawl`

- `copyProtect`: boolean, optional. When unset, `novel` / `dictionary` / `world` are protected by default and `blog` is not; setting `false` restores ordinary selection on a single novel or worldbuilding page.
- `crawl`: `open` / `paid` / `blocked`, optional. When unset, `blog` is `open`, the first 3 novel chapters (`NOVEL_TRIAL_CHAPTERS`) are `open`, and the later chapters plus `dictionary` / `world` are `blocked`; `paid` currently behaves the same as `blocked` and will be switched once Pay Per Crawl is approved.
- Both fields are written in the content file's frontmatter; the CMS accepts a boolean or the strings `'true'` / `'false'` and preserves them as given on save, but the admin form does not expose either field (you have to edit the frontmatter directly).
- A per-entry override does not affect robots.txt generation: robots still follows the content collections as built and their `crawl` values.

## Turning off the watermark

- The watermark is written at build time by `src/lib/watermark-plugin.mjs`; without `WATERMARK_SECRET` it prints a single warning and skips, and does not fail the build.
- To turn it off temporarily: remove `WATERMARK_SECRET` from the Cloudflare Workers Builds build variables, or simply do not set it for a local build. To remove it permanently: take `createWatermarkPlugin()` out of the `mdastPlugins` array in `astro.config.mjs`.
- Turning it off only affects subsequent builds; HTML that has already been produced keeps the old watermark until it is rebuilt and deployed. The stored Markdown, `/search-index.json`, RSS, OG images, and sitemap never carry the watermark.

## Cloudflare rate limiting rule template

This section only covers single-IP rate limiting for **document pages** (`/posts/novel/*`, `/world/*`, `/dictionary/*`). SSR pages such as `/posts`, `/about`, and `/status`, and `/api/*`, are out of scope here; API rate limiting is still handled inside the Worker by the `ratelimits` binding in `wrangler.jsonc`.

### Why a WAF rule rather than the Worker's `ratelimits` binding

`/posts/novel/<slug>`, `/world/<slug>`, and `/dictionary/<slug>` are all pages with `export const prerender = true`: the adapter serves them straight from `ASSETS` before `app.render`, so neither `src/middleware.ts` nor the page route code runs (see [`DEPLOY-CLOUDFLARE.md`](../DEPLOY-CLOUDFLARE.md) §14 and §15). The Workers Rate Limiting API only takes effect when Worker code actually calls `env.BINDING.limit({ key })` ([Cloudflare: Rate Limiting (Workers)](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), accessed 2026-11-08; the page states it was last updated 2026-10-21). In this project only `/api/*` calls those three bindings; the document pages have no call site at all. Adding Worker-side rate limiting to the document pages would mean rewriting the adapter entry point or adding a wrapper layer, and that would bring back the `Range` / `ETag` problems already solved in §15.

Rate limiting for the document pages therefore has to be delegated to a **Cloudflare WAF rate limiting rule**: it sits in front of the asset layer and does not depend on whether the Worker runs.

### Plan limits (official availability table)

The numbers below are taken from the availability table in [Cloudflare: Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) (accessed 2026-11-08; the page states it was last updated 2026-08-25):

| Item                        | Free               | Pro                                            | Business                                     | Enterprise                                             |
| --------------------------- | ------------------ | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| Rule count                  | 1                  | 2                                              | 5                                            | 100                                                    |
| Available expression fields | Path, Verified Bot | Host, URI, Path, Full URI, Query, Verified Bot | The above plus Method, Source IP, User Agent | Broader (including Bot Management, header, body, etc.) |
| Counting characteristic     | IP                 | IP                                             | IP, IP (NAT-aware)                           | Several                                                |
| Counting period             | 10 seconds only    | Up to 1 minute                                 | Up to 10 minutes                             | Up to 65,535 seconds                                   |
| Mitigation time             | 10 seconds only    | Up to 1 hour                                   | Up to 1 day                                  | Longer                                                 |
| Custom counting expression  | Not supported      | Not supported                                  | Supported                                    | Supported                                              |
| Exclude cached assets       | Not supported      | Not supported                                  | Supported                                    | Supported                                              |
| Custom block response       | Not supported      | Supported                                      | Supported                                    | Supported                                              |

The two limits that matter most for this site:

- **Free has only 1 rule**, so the three prefixes must be combined with `or` into a single expression, and all three then share one threshold.
- **Free's counting period and mitigation time are both fixed at 10 seconds**, so it can only stop "high frequency within 10 seconds" and not a slow crawler that fetches once every 10 seconds.

In addition, Free / Pro plans cannot exclude cached assets in the dashboard (official parameter documentation: the availability of `requests_to_origin` depends on the plan, and when it is not offered Cloudflare applies the rule to cached assets too; see [Rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/), accessed 2026-11-08, last updated 2026-11-04). For this template that is actually an advantage: requests for cached document pages are still counted, so a crawler cannot escape by hitting the cache, while the expression only matches the three document prefixes, so `/_astro/*`, `/og/*`, `/search-index.json`, and other subresources are not counted.

### Rule expression (complete version)

One rule, three prefixes. Paste this into the expression field under Security rules → Create rule → Rate limiting rules:

```text
(starts_with(http.request.uri.path, "/posts/novel/") or
 starts_with(http.request.uri.path, "/world/") or
 starts_with(http.request.uri.path, "/dictionary/"))
```

- Uses the `starts_with()` function rather than the `wildcard` operator: the dashboard compiles "starts with" into this function, and the `matches` operator requires Business or above ([Rules language operators](https://developers.cloudflare.com/ruleset-engine/rules-language/operators/), accessed 2026-11-08, last updated 2026-10-01). If your dashboard version offers an equivalent `wildcard` form and your plan allows it, the semantics are the same, but what your dashboard can actually save is what counts.
- The expression matches document pages only; `http.request.uri.path` does not include the query string, so `/posts/novel/x?utm=…` also matches, which is the intended behaviour.
- Set the counting characteristic to **IP** (`ip.src`). On the Free plan that is the only option, and a custom counting expression neither needs to be nor can be configured.

### Suggested starting thresholds and rollout

All thresholds below are expressed as "document requests per IP per 10 seconds", because Free's counting period is fixed at 10 seconds. The numbers are **starting suggestions, not measured against this site's traffic** (see the unconfirmed list below); they need correcting with Security Events and reader reports after going live.

| Stage       | Action      | Threshold (per IP / 10s) | Suggested observation period | Purpose                                                                                       |
| ----------- | ----------- | ------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Baseline | No rule yet | —                        | 1 week                       | See the distribution of normal readers and known crawlers in Security Analytics / access logs |
| 2. Loose    | Block       | 60                       | 1 week                       | Block only obvious anomalies; confirm no normal reader is caught                              |
| 3. Narrower | Block       | 30                       | 3–7 days                     | Move gradually toward the real requirement                                                    |
| 4. Target   | Block       | 20                       | Ongoing                      | Day-to-day operating value; re-check Security Events after every change                       |

Note that "Log first, then Block" is not possible on Free / Pro: the **Log action is Enterprise only** ([Rules language actions](https://developers.cloudflare.com/ruleset-engine/rules-language/actions/), accessed 2026-11-08, last updated 2026-04-23). The alternative is:

1. For the first week, create no rule at all and use Security Analytics only to establish a baseline.
2. In the second week, go live with "loose threshold + Block" and treat it as the de facto observation phase: a Block in a rate limiting rule returns HTTP 429, and the blocked requests show up in Security Events, where each one can be reviewed for whether it was expected.
3. Narrow the threshold only after confirming there is no collateral damage; change one stage at a time and keep at least 3 days of observation between changes.
4. If collateral damage is obvious for a while (for example the reader surge after a new chapter is published), temporarily switch the action to Managed Challenge or move the threshold back one stage, rather than disabling the rule outright.

### Not hurting search engines or fast-browsing readers

- **Search engines**: Cloudflare officially warns that applying rate limiting to Verified Bots **may affect SEO** (the Rate limiting rules page above; see also [Improve SEO](https://developers.cloudflare.com/fundamentals/performance/improve-seo/), accessed 2026-11-08, last updated 2026-04-20: "Rate limiting rules are allowing Verified Bots"). If your plan and the available fields allow it, add an exclusion condition to the expression; but whether the Free plan accepts `cf.verified_bot_category` (or the underlying name behind the dashboard's "Verified Bot" field) **is still unconfirmed**, and until it is proven, do not put an unverified field into a live rule — a failed save is the good outcome, a silent non-match is much harder to notice. The practical alternative protection is: keep the threshold no lower than a normal crawler's fetch cadence, and watch crawling statistics in Search Console after going live; if the crawler frequently receives 429, move the threshold back one stage.
- **Fast-browsing readers**: this site enables Swup's `preload: { hover: true, visible: true }` (`astro.config.mjs`), so chapter links are prefetched on hover or when they become visible, and during fast page-turning a single IP may generate several document requests within 10 seconds. This is the main reason the target threshold is set at 20 rather than 5; if preload is turned off later, the threshold can be narrowed again. Several people behind NAT / a campus network / a mobile carrier network sharing one egress IP also amplifies the risk of collateral damage — and that is the biggest weakness of the Free plan (IP counting only).
- **Do not** include `/`, `/_astro/*`, `/og/*`, or `/search-index.json` in the expression; a single page view fetches dozens of subresources, which would make the threshold meaningless and could lock out the whole site by mistake.

### Known limits and pitfalls

- **Counting is not exact**: the official wording notes that rate limiting "is not designed for the precise number of requests to reach origin", that counter updates may lag by several seconds, and that requests over the threshold may still arrive before the block takes effect (Rate limiting rules page, accessed 2026-11-08).
- **Each data centre counts separately**: Cloudflare does not provide a global counter across its entire network; every data centre maintains its own count ([Request rate](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/), accessed 2026-11-08, last updated 2026-04-16). A distributed crawler (many IPs, many regions) is almost never stopped by a single rule.
- **Path normalisation differences**: origin and Cloudflare may normalise / decode paths differently, so a rewritten path may bypass a path rule; before going live, check the zone's URL normalization setting ([Best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/), accessed 2026-11-08, last updated 2026-10-23).
- **A 429 is cheap**: Free's mitigation time is fixed at 10 seconds, so switching IP or waiting 10 seconds gets past it; the rule in this section only reduces the efficiency of "mindless high-speed scraping" and barely deters a copier with resources.
- **Only HTTP paths are protected**: content that has already been downloaded, screenshotted, or retyped by hand is unaffected by any rate limiting.

### Unconfirmed

1. Whether the Free plan accepts `cf.verified_bot_category` (or the underlying expression name behind the dashboard's "Verified Bot" field) in rate limiting rules — the official availability table only says "Verified Bot", and the API field name has not been proven.
2. Dashboard menu and field names ("Security rules" → "Rate limiting rules", and how the counting characteristic and period are presented) may differ between versions; whatever the actual dashboard shows is authoritative.
3. The 60 / 30 / 20 thresholds in the table above are starting suggestions and have not been validated against this site's traffic; at least a week of baseline data is needed before settling them.
4. If `/_astro/*` or media files are to be rate limited in future, first confirm that it will not break Safari's `Range` behaviour and caching (see `DEPLOY-CLOUDFLARE.md` §15).

## Handling a discovered copy

The following are operating steps only, not legal advice. Individual cases (especially cross-border platforms, fair use / fair dealing, and platform liability) should be discussed with a professional familiar with Hong Kong's Copyright Ordinance (Cap. 528).

### 1. Classify it first, then decide whether to act

Start by distinguishing three situations: (a) **licensed reproduction** — the footer or that page explicitly states CC BY-NC-ND 4.0, or a licence was granted individually; (b) **fair quotation** — a short quote, attributed, used for review or introduction, within the allowance described on this site's `/terms`; (c) **unauthorised full-text or large-portion reproduction, adaptation, or commercial use**. Only (c) goes through the process below; (a) and (b) need no action and must not be publicly accused.

### 2. Preserve the evidence before notifying the other party

Once a notice is sent, the other party may edit or delete the content immediately, so the evidence has to be saved first:

1. Take a **complete page archive** of the infringing page: "Save page as" in the browser to keep the original HTML and resources, a full-page screenshot (including the address bar and system time), and a PDF export; where necessary, use the Internet Archive's Save Page Now to keep a third-party snapshot.
2. Record **the publication times of both sides**: the other page's publication / update time, your own commit time (`git log --follow -- <file>`), and when you first went live.
3. Keep **comparison material**: a paragraph-by-paragraph side-by-side text comparison, identical typos / punctuation / coined terms (for example the worldbuilding proper nouns this site uses), and identical layout quirks. Measure the overlapping extent, and distinguish "identical paragraphs" from "identical topic".
4. Compute a hash for every file (`sha256sum`) and store it together with the screenshots, so that later you can show the files were not swapped.

### 3. Decode the watermark (if the content carries this site's watermark)

The decoding tool is `scripts/decode-watermark.mjs` and it needs the same `WATERMARK_SECRET` used at build time. It walks every entry under `src/content/{novel,dictionary,world}`, recomputes the HMAC signature, and compares it against the zero-width character sequences in the text; a partial copy that contains only one of the passages can still be matched.

```bash
# First confirm the secret matches the Workers Builds build variable
export WATERMARK_SECRET='<value used at build time>'
node scripts/decode-watermark.mjs < suspect.txt
```

Windows PowerShell pipelines can lose U+200B / U+200C when piping text into a native program; save the suspect text as a UTF-8 file first, then run `cmd /c "node scripts/decode-watermark.mjs < suspect.txt"` or redirect from the file directly.

1. Obtain the original text or image from the infringing page (prefer the original HTML / original image, not just a screenshot; screenshots and image compression lose zero-width characters).
2. Run the command above; the output lists matching `collection/id` values (for example `novel/chapter-1`) or "not found". Keep the output in the same directory as the evidence from step 2.
3. If nothing matches, fall back to alternative evidence: unique strings in the content, coined proper nouns, typos, layout quirks, and "internal links or image paths that only exist on this site appearing on the other page". Mark such alternative evidence in the record as an indirect comparison; do not write it up as "the watermark was decoded".
4. The watermark is only "possible" evidence: zero-width characters may have been stripped or rewritten by the other party or by their tools, and a watermark alone is not enough to prove the provenance of a whole article; use it together with commit times, publication times, and other textual features.

### 4. Notify the platform and the host

1. **Contact them directly first** (if a usable contact address can be found): briefly describe the pages involved, ask for removal or for attribution and licensing to be added, and give a reasonable deadline. Keep a copy of what you sent.
2. **Platform complaints**: submit through each platform's published copyright / infringement complaint process (GitHub, Medium, Vocus, Facebook, Telegram channels, and so on each have different forms and requirements), attaching the evidence from step 2, both URLs, a statement of your rights, and a statement that "the content is not under a CC licence or exceeds the licence scope". Do not misrepresent the licensing status.
3. **Host / CDN complaints**: if the other party runs their own site, find the host through WHOIS or the site footer and send the same material to its abuse address; the complaint must name the specific URLs and the infringing passages, not just "they copied me".
4. **Local routes**: for Hong Kong cases, consider consulting a lawyer first about whether it is appropriate to approach Hong Kong Customs (which handles criminal copyright enforcement) or a relevant body; whether infringement has occurred and whether a report is worthwhile are professional judgements.

### 5. Record and follow up

1. Keep an incident record: discovery date, source URLs, evidence file paths, notification dates and recipients, replies, and outcome (taken down / attribution added / no response). Store it somewhere private.
2. When the same source recurs, accumulate the record before acting again; do not publicly name an unproven copier in a press release or on social media, to avoid defamation and privacy risks.
3. After the incident, review whether the defences need adjusting: rate limiting thresholds, `copyProtect`, watermark parameters, and the robots / `crawl` tiers. After adjusting them, update this document and the relevant sections of `DEPLOY-CLOUDFLARE.md`.

### Consult professional advice

This document is an in-house set of operating notes, not legal advice, and it does not constitute a judgement on the outcome of any individual case. Where licence scope, fair use / fair dealing, cross-border jurisdiction, platform liability, or the amount of a claim is involved, seek professional advice (a lawyer or a relevant body) before deciding whether to take legal action.

## References

- [Cloudflare: Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) (accessed 2026-11-08; last updated 2026-08-25)
- [Cloudflare: Rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/) (accessed 2026-11-08; last updated 2026-11-04)
- [Cloudflare: Request rate](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/) (accessed 2026-11-08; last updated 2026-04-16)
- [Cloudflare: Rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/) (accessed 2026-11-08; last updated 2026-10-23)
- [Cloudflare: Create a rate limiting rule in the dashboard](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/) (accessed 2026-11-08; last updated 2026-08-03)
- [Cloudflare: Rules language actions](https://developers.cloudflare.com/ruleset-engine/rules-language/actions/) (accessed 2026-11-08; last updated 2026-04-23)
- [Cloudflare: Rules language operators](https://developers.cloudflare.com/ruleset-engine/rules-language/operators/) (accessed 2026-11-08; last updated 2026-10-01)
- [Cloudflare: Rate Limiting (Workers binding)](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (accessed 2026-11-08; last updated 2026-10-21)
- [Cloudflare: Improve SEO](https://developers.cloudflare.com/fundamentals/performance/improve-seo/) (accessed 2026-11-08; last updated 2026-04-20)
