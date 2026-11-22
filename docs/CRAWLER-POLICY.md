# Crawler Policy and Edge Blocking (Crawler Policy)

This document explains the crawler policy of `fluentfolio`: which content is public, which is intended only for human readers rather than search engines, which part of the code generates `robots.txt`, and why "actually blocking AI crawlers" necessarily requires separate rules at the Cloudflare edge.

> Fact-check date: 2026-11-08. Every non-obvious Cloudflare behaviour in this document comes with an official link; anything that could not be confirmed from the official documentation is marked "unconfirmed" rather than guessed.

## Contents

- [1. Policy tiers](#1-policy-tiers)
- [2. What the code actually does](#2-what-the-code-actually-does)
- [3. Why robots.txt alone is not enough](#3-why-robotstxt-alone-is-not-enough)
- [4. What must be configured by hand in the Cloudflare dashboard](#4-what-must-be-configured-by-hand-in-the-cloudflare-dashboard)
- [5. WAF custom rule template](#5-waf-custom-rule-template)
- [6. How to verify, and curl](#6-how-to-verify-and-curl)
- [7. Pay Per Crawl status](#7-pay-per-crawl-status)
- [8. To be confirmed with Cloudflare](#8-to-be-confirmed-with-cloudflare)
- [9. References](#9-references)

## 1. Policy tiers

The single source of truth for the tiers is [`src/lib/crawl-policy.ts`](../src/lib/crawl-policy.ts); `robots.txt`, the content schema, and the tests are all derived from it.

| Tier      | Content                                                                                       | Current `robots.txt` state                                    | Intended enforcement                                   |
| --------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `open`    | Home page, `/posts`, blog posts, `/about`, `/privacy`, `/terms`, novel chapters 1–3 (preview) | `Allow: /`; the novel preview also gets exact `Allow` entries | Not blocked                                            |
| `paid`    | Content reserved for Pay Per Crawl                                                            | Currently **identical to `blocked`** (`Disallow`)             | Becomes paid / HTTP 402 once the programme is approved |
| `blocked` | `/world/*`, `/dictionary/*`, novel chapter 4 onward                                           | `Disallow` prefixes for the AI group                          | Cloudflare WAF (where necessary) + robots.txt          |

`paid` and `blocked` have no behavioural difference today. The comment in `src/lib/robots-txt.ts` already marks the switch point; Pay Per Crawl is still in closed beta (see §7), and until the programme is approved we should not pretend that charging is already in effect.

### 1.1 Longest match

`Allow` / `Disallow` in `robots.txt` are not "first one written wins" — the **longest matching path** takes priority, and when two are the same length `Allow` wins. Therefore:

```text
Disallow: /posts/novel/            # block the whole novel first
Allow: /posts/novel/chapter-1/     # the preview chapter is longer, so it wins
```

The trailing slash is essential: written as `/posts/novel/chapter-1`, it would also be a prefix of `/posts/novel/chapter-10` and would let chapter ten through as well. With the trailing `/`, this `Allow` matches only that chapter's own URL prefix; that is exactly how the generator emits it.

This is also why the generator must list the full path of each preview chapter individually instead of writing a regular expression such as `Allow: /posts/novel/chapter-1$` — support for `$` and `*` in `robots.txt` varies, and exact paths are the most reliable.

## 2. What the code actually does

- [`src/pages/robots.txt.ts`](../src/pages/robots.txt.ts): `prerender = true`; at build time it reads the `blog` / `novel` / `dictionary` / `world` collections with `getCollection`, maps them to `CrawlPolicyEntry`, and hands them to a pure-function generator. The response type is `text/plain; charset=utf-8`.
- [`src/lib/robots-txt.ts`](../src/lib/robots-txt.ts): the pure function `buildRobotsTxt(entries)`. It imports neither Astro nor Cloudflare, so `node --test` can validate the output directly.
- `public/robots.txt` has been deleted. An old file and the new route existing side by side would create two truths; the build output is now the only source.
- Drafts (`draft: true`) never appear in any `Allow`. Content marked `paid` / `blocked` is `Disallow`ed either through `AI_RESTRICTED_PREFIXES` or through its actual path.
- The `User-agent: *` group keeps `Allow: /` and `Disallow: /admin`, and adds Cloudflare's Content Signals: `search=yes, ai-train=no, ai-input=no`.
- Search engines (Googlebot, Bingbot, DuckDuckBot, Baiduspider, YandexBot, and others) **never** appear in any `Disallow` group; `tests/robots.test.ts` asserts exactly this.

### 2.1 robots.txt is not access control

`robots.txt` is a voluntary standard (RFC 9309). It only works on crawlers that choose to comply; a malicious scraper, or one that does not care about its reputation, can simply ignore it. The same is true of Content Signals: it is a declaration, not a block. Any claim that AI crawlers are "already blocked" must be backed by an edge rule or an actual 403 / 402 response — robots.txt alone is not evidence.

### 2.2 AI crawler tokens and their basis

The names in the generator were not listed from memory; each one is checked against the following sources (accessed 2026-11-08):

| Token                | Category                 | Basis                                                                                                                         |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `GPTBot`             | Training                 | Cloudflare bot reference; the OpenAI official page was blocked when read — unconfirmed                                        |
| `ChatGPT-User`       | User-triggered           | Cloudflare bot reference                                                                                                      |
| `OAI-SearchBot`      | AI search                | Cloudflare bot reference                                                                                                      |
| `ClaudeBot`          | Training                 | Anthropic official crawler documentation                                                                                      |
| `Claude-User`        | User-triggered           | Anthropic official crawler documentation                                                                                      |
| `Claude-SearchBot`   | AI search                | Anthropic official crawler documentation                                                                                      |
| `anthropic-ai`       | Training (legacy)        | Anthropic's current documentation lists the ClaudeBot family instead; kept for compatibility — unconfirmed                    |
| `PerplexityBot`      | AI search                | Perplexity official crawler documentation                                                                                     |
| `Perplexity-User`    | User-triggered           | Perplexity official crawler documentation (which states that robots.txt is generally ignored when the user makes the request) |
| `Google-Extended`    | Training (control token) | Google official; there is no separate HTTP UA                                                                                 |
| `Applebot-Extended`  | Training (control token) | Apple official; it does not fetch pages itself                                                                                |
| `CCBot`              | Training                 | Common Crawl official `CCBot` page                                                                                            |
| `Bytespider`         | Training                 | Cloudflare bot reference (no official ByteDance crawler page found)                                                           |
| `Meta-ExternalAgent` | Training                 | Cloudflare bot reference (the UA is `meta-externalagent`)                                                                     |
| `Amazonbot`          | Training                 | Cloudflare bot reference                                                                                                      |
| `cohere-ai`          | Training                 | No current official Cohere crawler page found; kept as best-effort — unconfirmed                                              |
| `Diffbot`            | Training                 | Diffbot robots.txt FAQ (a separate `Diffbot-User` exists but is not listed in this policy)                                    |

`Google-Extended` and `Applebot-Extended` exist only in the "control" sense of robots.txt; an edge WAF cannot identify them by UA. `Perplexity-User`'s behaviour is likewise not guaranteed by robots.txt. All three are flagged in both the documentation and the code comments so that "we wrote it in robots.txt" is not mistaken for "it is blocked".

## 3. Why robots.txt alone is not enough

This site runs Astro 7 with `output: 'server'` deployed to Cloudflare Workers, **but the home page, articles, novel chapters, and similar pages are prerendered static assets**:

- Prerendered pages are produced at build time and do not pass through `src/middleware.ts` at request time, so path checks, CSP, and any "decide by User-Agent" logic inside the Worker never run. This is already recorded in [`DEPLOY-CLOUDFLARE.md`](../DEPLOY-CLOUDFLARE.md) §14 of this repository.
- `public/_headers` can only set static headers; it cannot branch on `User-Agent`.
- Therefore, if AI crawlers are to "really" be kept away from content such as `/world/*`, the only viable place is a **Cloudflare edge WAF custom rule** (or a Bot Management policy), not Worker code.

In one sentence: **the code declares the policy, the Cloudflare edge enforces it.**

## 4. What must be configured by hand in the Cloudflare dashboard

The following settings are **not part of the code in this repository**, and should not be presented as already configured. Please check each item after deploying.

### 4.1 AI Crawler and Agent access policies

Official documentation: <https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/> (Last updated: 2026-11-02)

- Location: **Security → Settings → filter by Bot traffic → AI Crawler and Agent access policies**.
- Behaviour is categorised as **Search**, **Agent**, and **Training**; the actions are **Block**, **Block on pages with ads**, **Allow (do not block)**, and **Disallow**, which applies to Training only.
- New domains default to **Allow** for all three. In other words, if you never go into the dashboard to change it, AI crawlers are permitted.
- `Disallow` (Training) is written into robots.txt; if Bot Preference Sync is also enabled, it blocks at the edge as well. Mixed crawlers (those used for both search and training) are excluded from edge blocking — see the official documentation for the details.

**Recommendation**: keep Search on Allow; set Training and Agent to Block or Disallow according to this document's policy. After configuring, always re-verify using §6 and watch Security → Analytics → Events for collateral damage to Googlebot.

### 4.2 Managed robots.txt (it rewrites the file you serve)

Official documentation: <https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/> (Last updated: 2026-11-02)

- Only when **Enable Bot Preference Sync** is on and at least one Search / Agent / Training policy is Block (or Disallow for Training) will Cloudflare **prepend** managed directives and Content Signals to the `robots.txt` you serve; when everything is Allow, your file is served as-is.
- If the site has no `robots.txt`, Cloudflare creates one on its behalf; if a `robots.txt` already returns HTTP 200, it is handled by "prepend and merge". This applies to all plans.
- Consequence: **the robots.txt you think you are serving may not be the final one.** After going live, always `curl` the real content and confirm there are no duplicate or contradictory groups.

### 4.3 How Bot Fight Mode interacts with Block AI Bots

Official documentation: <https://developers.cloudflare.com/bots/get-started/bot-fight-mode/> (Last updated: 2026-08-03)

- Bot Fight Mode is a free product that issues high-cost challenges to suspected bots.
- **It cannot be skipped by WAF custom rules or Page Rules**: Skip / Bypass / Allow have no effect on the pipeline it lives in. In other words, if Bot Fight Mode challenges legitimate traffic by mistake, a WAF rule cannot rescue it — the only option is to turn it off.
- It automatically enables JavaScript Detections, which cannot be disabled; under a `script-src 'self'` CSP this may produce console errors, and `/cdn-cgi/challenge-platform/` may need to be allowed where necessary.
- The old "Block AI bots" toggle is now managed by the AI Crawler and Agent access policies described in 4.1.

**Recommendation**: if Bot Fight Mode is enabled, you must confirm in Security → Analytics → Events (events are labelled `Bot Fight Mode`) that verified search engines such as Googlebot are not being challenged. That is the only empirical way to "confirm Googlebot is unaffected" — inference from documentation alone is not enough.

### 4.4 Checklist

- [ ] AI Crawler and Agent access policies: Search allowed; Training / Agent set according to policy.
- [ ] Bot Preference Sync: decide whether it is on or off, and compare against the `robots.txt` actually served.
- [ ] Bot Fight Mode: decide whether it is needed; if enabled, check Events for collateral damage to search engines.
- [ ] `curl` `/robots.txt` and confirm that `Content-Signal` and the AI group are present and not overridden into contradictory content by managed rules.
- [ ] Confirm Googlebot can still crawl, using the URL inspection tool in Google Search Console or the actual logs.
- [ ] Watch Cloudflare Security Events for 24 hours before deciding whether to widen the blocked scope.

## 5. WAF custom rule template

Official documentation: <https://developers.cloudflare.com/waf/custom-rules/> (Last updated: 2026-10-16)

First check the plan limits, otherwise even a perfectly written rule cannot be deployed:

| Item              | Free          | Pro           | Business      | Enterprise |
| ----------------- | ------------- | ------------- | ------------- | ---------- |
| Custom rule count | 5             | 20            | 100           | 1000       |
| `Log` action      | Not supported | Not supported | Not supported | Supported  |
| Regex             | Not supported | Not supported | Supported     | Supported  |

The template therefore deliberately uses only `starts_with()`, `in {}`, and `not (...)` to avoid Regex; the `Log` action is available only on Enterprise, so other plans can only Block directly (see 5.2). If the Free plan does not accept `cf.verified_bot_category`, use the "Verified Bot" field in the dashboard instead (coarser semantics, since it also matches verified bots that are not AI), or rely on robots.txt alone; do not put an unverified field into a live rule without a trial save (see §8 item 6).

### 5.1 Expression (Block)

Paste this into **Security → WAF → Custom rules → Create rule → Edit expression**, and replace the three preview chapters with the real slugs:

```text
(starts_with(http.request.uri.path, "/posts/novel/")
 or starts_with(http.request.uri.path, "/world/")
 or starts_with(http.request.uri.path, "/dictionary/"))
and cf.verified_bot_category in {"AI Crawler" "AI Assistant" "AI Search"}
and not (http.request.uri.path in {"/posts/novel/chapter-1" "/posts/novel/chapter-2" "/posts/novel/chapter-3"})
```

- `cf.verified_bot_category` is a Ruleset Engine field whose value is a string; valid legacy categories include `AI Crawler`, `AI Assistant`, `AI Search`, `Search Engine Crawler`, and others. Official documentation: <https://developers.cloudflare.com/bots/concepts/bot/verified-bots/> (Last updated: 2026-11-02) and <https://developers.cloudflare.com/bots/reference/bot-management-variables/> (Last updated: 2026-09-16).
- The new behaviour categories introduced on 2026-07-01 (Search / Agent / Training, …) are **not** WAF fields; use the legacy category values from the table above.
- This condition matches **verified** bots only. Unverified requests with a forged `User-Agent` are not stopped by this rule — which is exactly why both robots.txt and WAF are best-effort.
- `Google-Extended` and `Applebot-Extended` are **control tokens, not HTTP User-Agents**, so edge rules cannot identify them on their own; only robots.txt can express intent for those two. For `Perplexity-User`, the official statement is that "robots.txt is generally ignored when the user makes the request", so its behaviour also cannot be proven at the edge through robots.txt.

### 5.2 Log-first rollout

1. **Enterprise**: first set the action to `Log`, watch Security Events for 24–72 hours, confirm that every hit is an AI crawler and none is a search engine, then change it to `Block`.
2. **Free / Pro / Business**: there is no `Log` action. Block only **one prefix** first (for example `/world/`), watch Events and the webmaster tools for 24 hours, and add the remaining prefixes only after confirming there is no collateral damage.
3. Never put `Search Engine Crawler` from `cf.verified_bot_category` into a blocking condition at any point.

## 6. How to verify, and curl

```bash
# 1. The robots.txt actually served (including Cloudflare managed rules)
curl -sS https://www.example.com/robots.txt

# 2. Request a restricted path with an AI crawler UA
curl -sS -o /dev/null -w '%{http_code}\n' \
  -A 'GPTBot' https://www.example.com/world/

# 3. Request the same path with a search engine UA (it should stay crawlable)
curl -sS -o /dev/null -w '%{http_code}\n' \
  -A 'Googlebot' https://www.example.com/world/
```

**What these commands can and cannot prove:**

- They can prove: the content of `robots.txt`, the server's response code for "this UA string", and whether the WAF applies to requests from your current IP.
- They cannot prove: the behaviour of real crawlers. `User-Agent` can be forged freely; `curl -A GPTBot` is not GPTBot and carries no Web Bot Auth signature, so it will not match `cf.verified_bot_category`. Whether the block really stops OpenAI / Anthropic can only be established from Cloudflare's verified bot logs and real traffic.
- They also cannot prove that robots.txt is being honoured — it has no enforcement power to begin with.

## 7. Pay Per Crawl status

Official documentation (all read on 2026-11-08):

- <https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/> (Last updated: 2026-07-28)
- <https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-site-owner/set-a-pay-per-crawl-price/> (Last updated: 2026-07-28)
- <https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/faq/> (Last updated: 2026-04-23)

Confirmed points:

- **It is currently a closed beta**, and you must apply through <https://www.cloudflare.com/paypercrawl-signup/> or your Enterprise account manager. There is no switch you can simply turn on to start charging.
- Pricing is **a single price per zone**, charged on each successful retrieval of content (HTTP 200); you can choose Block / Charge / Allow per crawler, but you cannot set a different price for different crawlers. The minimum price is **US$0.001 per request**.
- Payment intent is expressed by the crawler in a request header; a crawler that does not pay receives **HTTP 402 Payment Required**. Cloudflare is the Merchant of Record.
- **A WAF or Bot Management block overrides charging**: a blocked crawler gets no content and is not billed. So "block first, charge later" must change the edge rules, not just robots.txt.
- Always-free paths: `/robots.txt`, `/sitemap.xml`, `/security.txt`, `/.well-known/security.txt`, `/crawlers.json`.
- Crawlers must use a standard UA onboarded to Cloudflare and be identified through **Web Bot Auth**; in other words, charging only applies to crawlers that are identifiable and whose signature can be verified, and has no effect on anonymous scrapers.

This site's approach before the programme is approved: the `paid` tier is handled exactly like `blocked`, and the switch point is marked in the code comments; "may be charged in the future" is not written up as "is charged now".

## 8. To be confirmed with Cloudflare

The official documentation does not give a clear enough answer to the following questions, or an account-level confirmation is required. **Do not present them publicly as fact**:

1. **Per-path pricing**: the documentation mentions that dynamic pricing can set different prices for different content, but whether that can be done per URL path, and how the rule would be configured, is unconfirmed.
2. **Ordering of WAF and billing**: the documentation says WAF / Bot Management overrides charging, but the actual sequence of the 402 and billing once a verified crawler has been allowed through by the WAF still needs to be confirmed from beta documentation or support.
3. **Payout account and tax**: the payout account, settlement currency, and tax liability (the actual process under Merchant of Record) are unconfirmed.
4. **Subdomain eligibility**: the requirement is that the domain uses Cloudflare nameservers or that its DNS is managed by Cloudflare; whether a subdomain such as `www.example.com` qualifies for the beta is unconfirmed.
5. **Beta admission**: whether ordinary plans can join, the review criteria, and the wait time are unconfirmed.
6. **WAF fields on the Free plan**: the official availability table only says "Verified Bot"; whether Free-plan custom rules accept `cf.verified_bot_category` (and what name the dashboard field actually compiles to) has not been proven. Before going live, trial-save a draft rule in the dashboard; if it fails, do not put that field into the production rule.

## 9. References

All links below were last accessed on **2026-11-08**.

- Content Signals Policy: <https://blog.cloudflare.com/content-signals-policy>
- Managed robots.txt: <https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/>
- AI Crawler and Agent access policies: <https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/>
- Verified bots (category values): <https://developers.cloudflare.com/bots/concepts/bot/verified-bots/>
- Bot Management variables: <https://developers.cloudflare.com/bots/reference/bot-management-variables/>
- WAF Custom rules (plan limits): <https://developers.cloudflare.com/waf/custom-rules/>
- Bot Fight Mode: <https://developers.cloudflare.com/bots/get-started/bot-fight-mode/>
- Pay Per Crawl: <https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/>
- AI Crawl Control bot reference (UA mapping): <https://developers.cloudflare.com/ai-crawl-control/reference/bots/>
- OpenAI crawler documentation: <https://platform.openai.com/docs/bots> (blocked by Cloudflare when read; the UA list follows the Cloudflare bot reference — unconfirmed)
- Anthropic crawler documentation: <https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>
- Perplexity crawler documentation: <https://docs.perplexity.ai/docs/resources/perplexity-crawlers>
- Google common crawlers (including `Google-Extended`): <https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers>
- Applebot and `Applebot-Extended`: <https://support.apple.com/en-us/119829>
- Common Crawl `CCBot`: <https://commoncrawl.org/ccbot>
- Diffbot robots.txt documentation: <https://www.diffbot.com/docs/crawl/faq/robots-txt>
