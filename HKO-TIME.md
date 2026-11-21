# Hong Kong Standard Time

This project displays all website timestamps in **Hong Kong Standard Time (HKST/HKT, UTC+08:00)**.

The Hong Kong Observatory (HKO) operates the Network Time Service at `香港天文台 Network Time Service（stdtime.gov.hk）` for synchronizing computer clocks. The HKO Web Clock is also an official way to check Hong Kong Standard Time.

Cloudflare Workers do not expose arbitrary UDP sockets for NTP, so a Worker should not attempt to query `香港天文台 Network Time Service（stdtime.gov.hk）:123` directly. The application therefore treats timestamps as UTC instants and formats them exclusively using the `Asia/Hong_Kong` timezone. The repo also includes `npm run check:hko-time` for local/CI verification against the HKO NTP service.

For the runtime website, `/api/time` exposes the current Worker timestamp together with the HKO time standard metadata.

## 目前網站實作

網站不會直接向 `stdtime.gov.hk` 發出 NTP 請求。即時時間由 Cloudflare runtime 提供 UTC 時間戳，前端再以 `Asia/Hong_Kong`（UTC+08:00）格式化為香港標準時間。
