# 私有內容倉庫

> **這是選用功能。** FluentFolio 預設把文章放在 `src/content/`，與程式碼在同一個倉庫，開箱即用。只有在你想把文章放進另一個**私有**倉庫時，才需要照這份文件操作。

網站程式碼與文章內容分開存放：

- **程式碼倉庫**（本倉庫，`fluentfolio`）：只有程式。啟用此模式時，把 `.gitignore` 裡的 `# /src/content/` 取消註解，並執行 `git rm -r --cached src/content` 停止追蹤，範例文章可以刪除。
- **內容倉庫**（私有，`fluentfolio-content`）：`src/content/{blog,novel,dictionary,world}`，目錄結構與原本完全相同。範本在 [`examples/private-content-repo/`](../examples/private-content-repo/)。

這樣做有兩個好處：把程式碼交給 AI 審查、交給別人協作或公開時，不會帶出任何文章；後台 CMS 的 token 也碰不到程式碼，實現 [ADR 0001](DECISIONS/0001-cms-write-path.md) 的選項 1。

## 運作方式

```text
/admin 儲存 ──► 內容倉庫 main ──► GitHub Action ──► Workers Builds deploy hook
                                                            │
程式碼倉庫 main ──────────────────────────────────────────►  建置
                                                            │
                          prebuild: scripts/fetch-content.mjs 以唯讀 token
                          淺層 clone 內容倉庫，只複製四個 collection
                                                            ▼
                                                  astro build ──► 部署
```

- 建置時由 `scripts/fetch-content.mjs`（`prebuild`）取得內容。`src/content` 已有 Markdown 時會跳過，不會覆蓋。
- 在 Workers Builds 上拿不到內容時**建置直接失敗**，不會把空網站部署上線。
- 內容倉庫的 `draft: true` 草稿不會進入建置，也不會公開。
- 後台 CMS 仍用 `GITHUB_TOKEN` / `GITHUB_REPO`，只是 `GITHUB_REPO` 改成內容倉庫，程式碼不需要改。

## 一、遷移前先確認

```bash
git log --oneline -- src/content
```

這個倉庫的歷史裡若已有不想公開的內容，只刪檔案是不夠的，舊 commit 仍然讀得到。倉庫是私有的話影響有限；是公開的話，請把歷史內容視為已經公開，或用 `git filter-repo` 重寫歷史後強制推送。

## 二、建立內容倉庫

1. 在 GitHub 建立**私有**倉庫 `fluentfolio-content`（不要勾選 README）。
2. 把範本內容（`fluentfolio-content-template/`）放進去，再放入現有文章：

   ```bash
   cd fluentfolio-content-template
   git init -b main
   # 從程式碼倉庫搬現有內容（保留 src/content 結構）
   cp -r ../fluentfolio/src/content/. src/content/
   git add .
   git commit -m "Initial content"
   git remote add origin git@github.com:your-name/fluentfolio-content.git
   git push -u origin main
   ```

倉庫名稱不同的話，同步修改 `wrangler.jsonc` 的 `GITHUB_REPO` 與 Workers Builds 的 `CONTENT_REPO`。

## 三、建立兩個 token

兩個都是 Fine-grained personal access token，都只選內容倉庫（Only select repositories），**不要**用同一個。

| 用途           | 權限                     | 放在哪裡                                            |
| -------------- | ------------------------ | --------------------------------------------------- |
| 後台 CMS 寫入  | Contents: Read and write | Worker secret `GITHUB_TOKEN`                        |
| 建置時讀取內容 | Contents: **Read-only**  | Workers Builds 的 build secret `CONTENT_REPO_TOKEN` |

不要授予 Workflows 權限：CMS token 因此無法修改內容倉庫的 workflow，也就拿不到下面的 deploy hook。

## 四、設定 Cloudflare Workers Builds

在 Workers & Pages → `fluentfolio` → Settings → Builds：

1. **Variables and secrets**（這是建置用變數，Worker 執行時看不到）：
   - `CONTENT_REPO_TOKEN`：類型選 **Secret**，貼上唯讀 token
   - `CONTENT_REPO` = `your-name/fluentfolio-content`
   - `CONTENT_REQUIRED` = `1`
2. **Deploy Hooks**：新增一個，分支選 `main`，複製產生的 URL。

## 五、讓內容更新自動觸發部署

到內容倉庫 Settings → Secrets and variables → Actions，新增 repository secret：

- `SITE_DEPLOY_HOOK_URL` = 上一步複製的 deploy hook URL

deploy hook 的網址本身就是憑證，任何人拿到都能觸發建置（頻率上限為每個 Worker 每分鐘 10 次），所以只放在這個 secret。外洩時刪掉重建即可。

## 六、切換程式碼倉庫與 CMS

依序進行，避免空窗：

1. 先更新 Worker secret（換成內容倉庫的讀寫 token）：

   ```bash
   npx wrangler secret put GITHUB_TOKEN
   ```

2. 在程式碼倉庫套用本次變更，並停止追蹤已移走的內容：

   ```bash
   git rm -r --cached src/content
   git add -A
   git commit -m "Move content to a private repository"
   git push
   ```

3. 等 Workers Builds 完成。建置記錄應出現 `fetch-content: fetched N Markdown file(s) from …`。
4. 打開網站與 `/admin` 確認文章都在，儲存一次測試文章，確認內容倉庫的 Actions 觸發了新的建置。
5. 到 GitHub 刪除舊的、涵蓋程式碼倉庫的 `GITHUB_TOKEN`。

## 本機開發

把內容倉庫 clone 在程式碼倉庫旁邊，再鏡像進 `src/content`：

```bash
git clone git@github.com:your-name/fluentfolio-content.git ../fluentfolio-content
npm run fetch:content -- --from ../fluentfolio-content
npm run dev
```

`--from` 會取代 `src/content` 底下四個 collection 資料夾，**請在內容倉庫裡編輯**，不要直接改 `src/content`（它只是副本，不會被提交）。透過 `/admin` 發佈的文章，先在內容倉庫 `git pull` 再重新執行上面的指令。

沒有真實內容時，`node scripts/seed-mock-content.mjs --seed` 可以放入測試用的假文章。

## 交給 AI 審查時

- 只提供程式碼倉庫。`src/content` 被排除，`git archive` 也不會包含它。
- 不要提供內容倉庫，也不要貼 `.dev.vars`、`.env*`、任何 token。
- `tests/fixtures/` 只是假資料，可以放心提供。

## 這個做法保護什麼、不保護什麼

- **保護**：未發布的草稿、尚未公開的小說與世界觀設定，不會出現在程式碼倉庫或交給 AI 的壓縮檔裡。CMS token 外洩也改不到程式碼，只能改內容，而且可以從內容倉庫的歷史復原。
- **不保護**：已發布的文章。它們本來就會出現在網頁和 RSS 裡，任何人都能讀取。
- **仍需留意**：建置用的唯讀 token 外洩時，攻擊者能讀取內容倉庫（包含草稿）。請設定到期日並定期更換。程式碼倉庫的 `main` 建議另外開啟分支保護。

## 還原

1. 把 `wrangler.jsonc` 的 `GITHUB_REPO` 改回程式碼倉庫，並換回對應的 `GITHUB_TOKEN`。
2. 從 `.gitignore` 移除 `/src/content/`，把內容複製回 `src/content`。
3. 從 `package.json` 移除 `prebuild`。
