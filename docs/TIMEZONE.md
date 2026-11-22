# Display time zone

The site formats every timestamp with `Intl.DateTimeFormat` and a single IANA
time zone. Nothing is scraped or queried from an external clock: the Worker
already has a trustworthy UTC clock, and only the **presentation** zone is
configurable.

## Where it is configured

[`src/lib/time.ts`](../src/lib/time.ts) exports two constants:

```ts
export const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong';
export const HONG_KONG_UTC_OFFSET = '+08:00';
```

- `HONG_KONG_TIME_ZONE` is passed to `Intl.DateTimeFormat` by every formatter
  (`formatHKT`, `formatHKTDate`, `formatHKTDateTime`, `formatHKTTime`) and by
  the `/api/health`, `/api/runtime` and `/api/time` responses.
- `HONG_KONG_UTC_OFFSET` is only reported by `/api/time` as `utcOffset`.

## Changing the zone

1. Set `HONG_KONG_TIME_ZONE` to any IANA zone, for example
   `Europe/London`, `America/New_York` or `Asia/Tokyo`.
2. Update `HONG_KONG_UTC_OFFSET` to the matching fixed offset (for example
   `+00:00` or `-05:00`). It is a display label, not used for calculation, so
   a zone with daylight saving needs its **standard** offset here and the IANA
   zone handles the seasonal change.
3. If the interface language should follow the zone, also check
   `DEFAULT_LANG` and the `lang` attribute handling in
   [`src/i18n/ui.ts`](../src/i18n/ui.ts) and `src/layouts/BaseLayout.astro`.
4. Run `npm run check && npm test && npm run build`, then redeploy.

## What not to do

- Do not add an NTP client or fetch a public clock API at runtime. Workers
  cannot open UDP sockets, and an HTTP clock adds latency and a failure mode
  for something the runtime already provides.
- Do not hard-code formatted strings in content. Store UTC instants (the
  frontmatter `date` field) and format at render time.
