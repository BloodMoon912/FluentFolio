// Online admin CMS: post list and search, batch operations, the Markdown editor
// (preview, lint, upload) and tag management.
//
// Extracted verbatim from the processed <script> in src/pages/admin/index.astro.
// It stays a bundled module imported by that page, so it still runs exactly once
// per full page load.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { lint as runMarkdownlint } from 'markdownlint/sync';
import { createEnglishSlug, uniqueEnglishSlug } from '../lib/english-slug';
import { escapeHtml } from '../lib/escape-html';
import { createSearchEngine, type SearchDocument, type SearchEngine } from '../lib/search-core';

type ContentKind = 'blog' | 'novel' | 'dictionary' | 'world';

type Post = {
  collection: ContentKind;
  id: string;
  slug: string;
  sha: string;
  title: string;
  description: string;
  date: string | null;
  type: string;
  category: string;
  tags: string[];
  draft: boolean;
  featured: boolean;
  data: Record<string, any>;
};

let activeCollection: 'all' | ContentKind = 'all';
let postsReady = false;
let searchEngine: SearchEngine | null = null;

const COLLECTION_LABELS: Record<ContentKind, string> = {
  blog: '隨筆',
  novel: '小說',
  dictionary: '詞典',
  world: '世界觀',
};

// ---- Tabs -------------------------------------------------------------
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabViews: Record<string, HTMLElement> = {
  posts: document.getElementById('tab-view-posts')!,
  tags: document.getElementById('tab-view-tags')!,
};
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    // `active` is the legacy marker the first button ships with; keep it in
    // sync with `is-active` or both tabs stay highlighted after the first click.
    tabButtons.forEach((b) => {
      b.classList.toggle('is-active', b === btn);
      b.classList.toggle('active', b === btn);
    });
    const tab = btn.dataset.tab!;
    Object.entries(tabViews).forEach(([key, el]) => {
      el.classList.toggle('active', key === tab);
      el.style.display = key === tab ? 'block' : 'none';
    });
    if (tab === 'tags') loadTagsTab();
  });
});

// ---- Shared state -------------------------------------------------------
let allTags: string[] = [];
let allCategories: string[] = [];
let loadedPosts: Post[] = [];
const selectedSlugs = new Set<string>();

async function loadTagsAndCategories() {
  try {
    const [tagsRes, catRes] = await Promise.all([fetch('/api/admin/tags'), fetch('/api/admin/categories')]);
    const tagsData = await tagsRes.json();
    const catData = await catRes.json();
    allTags = tagsData.ok ? tagsData.tags.map((t: { tag: string }) => t.tag) : [];
    allCategories = catData.ok ? catData.categories : [];

    const categorySelect = document.getElementById('f-category') as HTMLSelectElement | null;
    if (categorySelect) {
      const selected = categorySelect.value || 'General';
      categorySelect.innerHTML = [...new Set(['General', ...allCategories])]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
        .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
        .join('');
      if (![...categorySelect.options].some((option) => option.value === selected)) {
        categorySelect.add(new Option(selected, selected));
      }
      categorySelect.value = selected;
    }

    const tagSelect = document.getElementById('tag-select') as HTMLSelectElement | null;
    if (tagSelect) {
      const selected = tagSelect.value;
      tagSelect.innerHTML =
        '<option value="">選擇現有標籤…</option>' +
        allTags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('');
      tagSelect.value = selected;
    }
  } catch {
    // A network error must not prevent editing already-loaded content.
  }
}

// ---- Post list + batch toolbar ------------------------------------------
const listView = document.getElementById('list-view')!;
const editorView = document.getElementById('editor-view')!;
const postListEl = document.getElementById('post-list')!;
const batchToolbar = document.getElementById('batch-toolbar')!;
const batchCountEl = document.getElementById('batch-count')!;
const formMessage = document.getElementById('form-message')!;

function updateBatchToolbar() {
  batchToolbar.style.display = selectedSlugs.size > 0 ? 'flex' : 'none';
  batchCountEl.textContent = `已選取 ${selectedSlugs.size} 篇`;
}

function showList() {
  exitFocusWriting();
  editorView.style.display = 'none';
  listView.style.display = 'block';
  selectedSlugs.clear();
  updateBatchToolbar();
  loadPosts();
  loadTagsAndCategories();
}

function showEditor() {
  listView.style.display = 'flex';
  editorView.style.display = 'block';
  formMessage.textContent = '';
}

function renderPostList(posts: Post[]) {
  postListEl.innerHTML = '';
  if (posts.length === 0) {
    postListEl.innerHTML = '<p class="admin-loading">找不到符合條件的內容。</p>';
    return;
  }
  for (const post of posts) {
    const card = document.createElement('div');
    card.className = 'post-card';
    card.innerHTML = `
          ${
            post.collection === 'blog'
              ? `<input type="checkbox" data-slug="${escapeHtml(post.slug)}" />`
              : '<span class="collection-dot" aria-hidden="true"></span>'
          }
          <div class="post-card-body">
            <div><span class="badge collection-badge">${escapeHtml(COLLECTION_LABELS[post.collection])}</span>${post.draft ? '<span class="badge badge-draft">草稿</span>' : ''}${post.featured && post.collection === 'blog' ? '<span class="badge badge-featured">精選</span>' : ''}</div>
            <strong>${escapeHtml(post.title)}</strong>
            <span style="font-size:12px; color:var(--subtle);">${escapeHtml(post.date ?? '')}${post.category ? ' · ' + escapeHtml(post.category) : ''}${post.tags.length ? ' · ' + post.tags.map(escapeHtml).join(', ') : ''}</span>
          </div>
        `;
    card.querySelector('.post-card-body')!.addEventListener('click', () => openEditor(post.collection, post.id));
    const checkbox = card.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    checkbox?.addEventListener('change', () => {
      if (checkbox.checked) selectedSlugs.add(post.slug);
      else selectedSlugs.delete(post.slug);
      updateBatchToolbar();
    });
    postListEl.appendChild(card);
  }
}

function rebuildSearchEngine() {
  const documents: SearchDocument[] = loadedPosts.map((post) => ({
    kind: post.collection,
    id: post.id,
    title: post.title,
    description: post.description,
    tags: post.tags,
    // The editor promises "搜尋標題或 ID" in the relation picker and the list
    // search field; the shared Fuse config only indexes these keys, so the id
    // has to travel as a keyword.
    keywords: [post.id],
    url: '',
  }));
  searchEngine = createSearchEngine(documents);
}

async function loadPosts() {
  postListEl.innerHTML = '<p class="admin-loading">載入中…</p>';
  try {
    // Load all collections once so the relation picker can search every valid target.
    const res = await fetch('/api/admin/content');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '載入失敗');
    const byKey = new Map<string, Post>();
    for (const item of data.items as any[]) {
      const fm = item.data ?? {};
      const post: Post = {
        collection: item.collection,
        id: item.id,
        slug: item.id,
        sha: item.sha ?? '',
        title: fm.title || fm.word || item.id,
        description: fm.description || fm.definition || '',
        date: fm.date || null,
        type: fm.type || fm.partOfSpeech || '',
        category: fm.category || fm.type || fm.partOfSpeech || fm.volume || '',
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        draft: Boolean(item.draft),
        featured: Boolean(fm.featured),
        data: fm,
      };
      // The list endpoint returns a published entry and its D1 draft override
      // as two rows. The single-entry GET already lets the draft win, so the
      // list must do the same or every drafted edit shows up twice.
      const key = `${post.collection}:${post.id}`;
      if (!byKey.has(key) || post.draft) byKey.set(key, post);
    }
    loadedPosts = [...byKey.values()];
    postsReady = true;
    rebuildSearchEngine();
    applyPostSearch();
  } catch (err: any) {
    postListEl.innerHTML = `<p class="admin-loading" style="color:var(--bad);">${escapeHtml(err.message || '載入失敗')}</p>`;
  }
}

function applyPostSearch() {
  const query = (document.getElementById('post-search') as HTMLInputElement | null)?.value.trim() || '';
  const kind = activeCollection === 'all' ? undefined : activeCollection;
  if (!query || !searchEngine) {
    renderPostList(kind ? loadedPosts.filter((post) => post.collection === kind) : loadedPosts);
    return;
  }
  const matches = searchEngine.search(query, kind);
  const byKey = new Map(loadedPosts.map((post) => [`${post.collection}:${post.id}`, post]));
  renderPostList(matches.map((match) => byKey.get(`${match.kind}:${match.id}`)).filter(Boolean) as Post[]);
}

document.getElementById('post-search')?.addEventListener('input', applyPostSearch);

// The list search field shows a "/" kbd hint; make that hint true, but never
// steal the key while the user is typing in a field.
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (editorView.style.display !== 'none') return;
  const search = document.getElementById('post-search') as HTMLInputElement | null;
  if (!search) return;
  event.preventDefault();
  search.focus();
});

// Collection switch: the list and the “new content” button follow it.
const collectionButtons = document.querySelectorAll<HTMLButtonElement>('[data-collection]');

function applyCollectionUi() {
  const newBtn = document.getElementById('new-post-btn');
  if (newBtn) {
    // "全部" is a filter, not a collection: "＋ 新全部" was nonsense.
    newBtn.textContent =
      activeCollection === 'all'
        ? '＋ 新內容'
        : activeCollection === 'blog'
          ? '＋ 新隨筆'
          : `＋ 新${COLLECTION_LABELS[activeCollection]}`;
  }
  batchToolbar.style.display = 'none';
}

collectionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeCollection = (button.dataset.collection as 'all' | ContentKind) ?? 'all';
    collectionButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    applyCollectionUi();
    showList();
  });
});

async function runBatch(action: string, extra: Record<string, any> = {}) {
  const slugs = [...selectedSlugs];
  if (slugs.length === 0) return;
  try {
    const res = await fetch('/api/admin/posts/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, slugs, ...extra }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '批次操作失敗');
    if (data.errors?.length) {
      alert(
        `完成 ${data.touched} 篇,${data.errors.length} 篇失敗:\n${data.errors.map((e: any) => `${e.slug}: ${e.error}`).join('\n')}`,
      );
    }
    selectedSlugs.clear();
    updateBatchToolbar();
    loadPosts();
  } catch (err: any) {
    alert(err.message || '批次操作失敗');
  }
}

document.querySelectorAll<HTMLButtonElement>('.batch-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action!;
    if (action === 'delete') {
      if (confirm(`確定要刪除選取的 ${selectedSlugs.size} 篇文章嗎?這個動作無法復原。`)) runBatch('delete');
    } else if (action === 'set-draft-true') {
      runBatch('set-draft', { draft: true });
    } else if (action === 'set-draft-false') {
      runBatch('set-draft', { draft: false });
    } else if (action === 'set-featured-true') {
      runBatch('set-featured', { featured: true });
    } else if (action === 'set-featured-false') {
      runBatch('set-featured', { featured: false });
    } else if (action === 'set-category') {
      const value = prompt(`將選取的 ${selectedSlugs.size} 篇文章分類設為:`);
      if (value && value.trim()) runBatch('set-category', { value: value.trim() });
    } else if (action === 'add-tag') {
      const value = prompt(`為選取的 ${selectedSlugs.size} 篇文章新增標籤:`);
      if (value && value.trim()) runBatch('add-tag', { value: value.trim() });
    } else if (action === 'remove-tag') {
      const value = prompt(`從選取的 ${selectedSlugs.size} 篇文章移除標籤:`);
      if (value && value.trim()) runBatch('remove-tag', { value: value.trim() });
    }
  });
});

// ---- Tags management tab ------------------------------------------------
async function loadTagsTab() {
  const tagsBody = document.getElementById('tags-tbody')!;
  const categoriesBody = document.getElementById('categories-tbody')!;
  const loading = '<tr><td colspan="3" style="padding:12px 4px; color:var(--muted);">載入中…</td></tr>';
  tagsBody.innerHTML = loading;
  categoriesBody.innerHTML = loading;
  try {
    const [tagsRes, categoriesRes] = await Promise.all([fetch('/api/admin/tags'), fetch('/api/admin/categories')]);
    const [tagsData, categoriesData] = await Promise.all([tagsRes.json(), categoriesRes.json()]);
    if (!tagsData.ok) throw new Error(tagsData.error || '標籤載入失敗');
    if (!categoriesData.ok) throw new Error(categoriesData.error || '分類載入失敗');

    const renderRows = (
      tbody: HTMLElement,
      rows: Array<{ value: string; count: number }>,
      noun: '標籤' | '分類',
      basePath: string,
    ) => {
      tbody.innerHTML = '';
      if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="padding:12px 4px; color:var(--muted);">尚無${noun}</td></tr>`;
        return;
      }
      for (const { value, count } of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="padding:10px 4px;">${escapeHtml(value)}</td>
          <td style="padding:10px 4px; color:var(--muted);">${count}</td>
          <td style="padding:10px 4px; text-align:right; white-space:nowrap;">
            <button type="button" class="tags-row-btn" data-action="rename">重新命名</button>
            <button type="button" class="tags-row-btn is-danger" data-action="delete">刪除</button>
          </td>`;
        tr.querySelector('[data-action="rename"]')!.addEventListener('click', async () => {
          const next = prompt(`將${noun}「${value}」重新命名為:`, value);
          if (!next || !next.trim() || next.trim() === value) return;
          const response = await fetch(`${basePath}/rename`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              noun === '標籤'
                ? { oldTag: value, newTag: next.trim() }
                : { oldCategory: value, newCategory: next.trim() },
            ),
          });
          const result = await response.json();
          if (!result.ok) return alert(result.error || '重新命名失敗');
          await Promise.all([loadTagsTab(), loadTagsAndCategories(), loadPosts()]);
        });
        tr.querySelector('[data-action="delete"]')!.addEventListener('click', async () => {
          const fallback = noun === '分類' ? 'General' : '';
          const detail = noun === '分類' ? `並將相關隨筆改為「${fallback}」` : '從所有相關內容中移除';
          if (!confirm(`確定要${detail}「${value}」嗎？將影響 ${count} 篇內容。`)) return;
          const response = await fetch(`${basePath}/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(noun === '標籤' ? { tag: value } : { category: value }),
          });
          const result = await response.json();
          if (!result.ok) return alert(result.error || '刪除失敗');
          await Promise.all([loadTagsTab(), loadTagsAndCategories(), loadPosts()]);
        });
        tbody.appendChild(tr);
      }
    };

    renderRows(
      categoriesBody,
      (
        categoriesData.categoryCounts ?? categoriesData.categories.map((category: string) => ({ category, count: 0 }))
      ).map((item: any) => ({ value: item.category, count: item.count })),
      '分類',
      '/api/admin/categories',
    );
    renderRows(
      tagsBody,
      tagsData.tags.map((item: any) => ({ value: item.tag, count: item.count })),
      '標籤',
      '/api/admin/tags',
    );
  } catch (err: any) {
    tagsBody.innerHTML = `<tr><td colspan="3" style="padding:12px 4px; color:var(--bad);">${escapeHtml(err.message || '載入失敗')}</td></tr>`;
    categoriesBody.innerHTML = tagsBody.innerHTML;
  }
}

// ---- Editor form ---------------------------------------------------------
const fOriginalSlug = document.getElementById('f-original-slug') as HTMLInputElement;
const fSlug = document.getElementById('f-slug') as HTMLInputElement;
const fSlugSource = document.getElementById('f-slug-source') as HTMLInputElement;
const fTitle = document.getElementById('f-title') as HTMLInputElement;
const fDescription = document.getElementById('f-description') as HTMLTextAreaElement;
const fDate = document.getElementById('f-date') as HTMLInputElement;
const fCategory = document.getElementById('f-category') as HTMLSelectElement;
const fType = document.getElementById('f-type') as HTMLInputElement;
const fVolume = document.getElementById('f-volume') as HTMLInputElement;
const fChapter = document.getElementById('f-chapter') as HTMLInputElement;
const fOrder = document.getElementById('f-order') as HTMLInputElement;
const fIpa = document.getElementById('f-ipa') as HTMLInputElement;
const fPos = document.getElementById('f-pos') as HTMLInputElement;
const fEtymology = document.getElementById('f-etymology') as HTMLTextAreaElement;
const fRelated = document.getElementById('f-related') as HTMLInputElement;
const relatedSearch = document.getElementById('related-search') as HTMLInputElement;
const relatedOptions = document.getElementById('related-options') as HTMLDivElement;
const relatedChips = document.getElementById('related-chips') as HTMLDivElement;
const fDraft = document.getElementById('f-draft') as HTMLInputElement;
const fFeatured = document.getElementById('f-featured') as HTMLInputElement;
const fFeaturedWrap = document.getElementById('f-featured-wrap') as HTMLLabelElement;
const fNotifyWrap = document.getElementById('f-notify-wrap') as HTMLLabelElement;
const fNotify = document.getElementById('f-notify') as HTMLInputElement;
const fBody = document.getElementById('f-body') as HTMLTextAreaElement;
const deleteBtn = document.getElementById('delete-btn') as HTMLButtonElement;
const tagChipList = document.getElementById('tag-chip-list') as HTMLDivElement;
const tagInput = document.getElementById('tag-input') as HTMLInputElement;
const tagSelect = document.getElementById('tag-select') as HTMLSelectElement;

let isEditingExisting = false;
let wasPublishedBeforeEdit = false;
let currentTags: string[] = [];
let currentRelated: string[] = [];
let slugManuallyEdited = false;
let currentCollection: ContentKind = 'blog';

function showRow(id: string, visible: boolean) {
  const row = document.getElementById(id);
  if (row) row.toggleAttribute('hidden', !visible);
}

function applyCollectionForm(collection: ContentKind) {
  currentCollection = collection;
  const titleLabel = document.getElementById('f-title-label');
  const descriptionLabel = document.getElementById('f-description-label');
  const relatedLabel = document.getElementById('f-related-label');
  if (titleLabel) titleLabel.textContent = collection === 'dictionary' ? '詞彙' : '標題';
  if (descriptionLabel) descriptionLabel.textContent = collection === 'dictionary' ? '定義' : '描述';
  if (relatedLabel) {
    relatedLabel.textContent =
      collection === 'dictionary' ? '相關詞彙' : collection === 'world' ? '相關世界觀條目' : '相關世界觀／詞典條目';
  }
  showRow('row-publish-date', collection === 'blog' || collection === 'novel');
  showRow('row-category', collection === 'blog');
  showRow('row-novel', collection === 'novel');
  showRow('row-dictionary', collection === 'dictionary');
  showRow('row-etymology', collection === 'dictionary');
  showRow('row-type', collection === 'world');
  showRow('row-related', collection === 'novel' || collection === 'dictionary' || collection === 'world');
  showRow('row-tags', collection === 'blog' || collection === 'novel');
  fFeaturedWrap.hidden = collection !== 'blog';
  fDate.required = collection === 'blog' || collection === 'novel';
  // Schema-required fields stay required only while their row is visible;
  // a hidden `required` input would make the form unsubmittable.
  fPos.required = collection === 'dictionary';
  fChapter.required = collection === 'novel';
  fRelated.required = false;
}

function renderTagChips() {
  tagChipList.innerHTML = '';
  currentTags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)} <button type="button" aria-label="移除標籤 ${escapeHtml(tag)}">×</button>`;
    chip.querySelector('button')!.addEventListener('click', () => {
      currentTags = currentTags.filter((item) => item !== tag);
      renderTagChips();
    });
    tagChipList.append(chip);
  });
}

function addTag(tagValue: string) {
  // Comma (half/full width) and newline are separators, so pasting
  // "a, b，c" adds three chips instead of one broken one.
  const values = tagValue
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const value of values) {
    if (!currentTags.includes(value)) currentTags.push(value);
  }
  tagInput.value = '';
  tagSelect.value = '';
  renderTagChips();
}

function addTagFromInput() {
  addTag(tagInput.value);
}

tagInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    addTagFromInput();
  } else if (event.key === 'Backspace' && tagInput.value === '' && currentTags.length) {
    currentTags.pop();
    renderTagChips();
  }
});
tagInput.addEventListener('blur', addTagFromInput);
document.getElementById('tag-add-selected')?.addEventListener('click', () => {
  if (tagSelect.value) addTag(tagSelect.value);
});

function relationCollections(): ContentKind[] {
  if (currentCollection === 'novel') return ['dictionary', 'world'];
  if (currentCollection === 'dictionary') return ['dictionary'];
  if (currentCollection === 'world') return ['world'];
  return [];
}

function relationTitle(post: Post): string {
  return `${COLLECTION_LABELS[post.collection]} · ${post.title}`;
}

function renderRelatedChips() {
  relatedChips.innerHTML = '';
  currentRelated.forEach((id) => {
    const candidates = loadedPosts.filter((post) => relationCollections().includes(post.collection) && post.id === id);
    const chip = document.createElement('span');
    chip.className = 'relation-chip';
    const label =
      candidates.length === 1
        ? `${relationTitle(candidates[0])} · ${id}`
        : candidates.length > 1
          ? `ID 重複 · ${id}`
          : `找不到條目 · ${id}`;
    chip.innerHTML = `<span>${escapeHtml(label)}</span><button type="button" aria-label="移除關聯 ${escapeHtml(id)}">×</button>`;
    chip.querySelector('button')!.addEventListener('click', () => {
      currentRelated = currentRelated.filter((value) => value !== id);
      renderRelatedChips();
      renderRelatedOptions();
    });
    relatedChips.append(chip);
  });
  fRelated.value = currentRelated.join(',');
}

function renderRelatedOptions() {
  const allowed = relationCollections();
  const query = relatedSearch.value.trim().toLocaleLowerCase();
  const byKey = new Map(loadedPosts.map((post) => [`${post.collection}:${post.id}`, post]));
  const searched =
    query && searchEngine
      ? searchEngine
          .search(query)
          .filter((match) => allowed.includes(match.kind) && !currentRelated.includes(match.id))
          .map((match) => byKey.get(`${match.kind}:${match.id}`))
          .filter((post): post is Post => Boolean(post))
      : loadedPosts.filter((post) => allowed.includes(post.collection) && !currentRelated.includes(post.id));
  // The Fuse keys do not include `id`, so match IDs directly: linking an entry
  // by its id is the documented legacy workflow this picker has to keep working.
  const directIdMatches = query
    ? loadedPosts.filter(
        (post) =>
          allowed.includes(post.collection) &&
          !currentRelated.includes(post.id) &&
          post.id.toLocaleLowerCase().includes(query),
      )
    : [];
  const deduped = new Map<string, Post>();
  for (const post of [...directIdMatches, ...searched]) deduped.set(`${post.collection}:${post.id}`, post);
  const candidates = [...deduped.values()].slice(0, 40);
  relatedOptions.innerHTML = '';
  if (allowed.length === 0 || candidates.length === 0) {
    relatedOptions.innerHTML = `<p class="relation-empty">${allowed.length ? '沒有符合的條目' : '此內容類型不支援關聯條目'}</p>`;
    relatedOptions.hidden = false;
    return;
  }
  candidates.forEach((post) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'relation-option';
    button.setAttribute('role', 'option');
    button.innerHTML = `<span class="relation-option__title">${escapeHtml(post.title)}</span><span class="relation-option__meta">${escapeHtml(COLLECTION_LABELS[post.collection])} · ${escapeHtml(post.id)}</span>`;
    button.addEventListener('click', () => {
      // Existing frontmatter stores bare IDs. Refuse an ambiguous duplicate ID
      // rather than silently linking to the wrong collection entry.
      const collisions = loadedPosts.filter((item) => allowed.includes(item.collection) && item.id === post.id);
      if (collisions.length > 1) {
        alert(`「${post.id}」在多個集合中重複，現有資料格式只儲存 ID，暫時不能安全選擇。請先調整其中一個條目的 ID。`);
        return;
      }
      currentRelated.push(post.id);
      relatedSearch.value = '';
      renderRelatedChips();
      renderRelatedOptions();
      relatedSearch.focus();
    });
    relatedOptions.append(button);
  });
  relatedOptions.hidden = false;
}

relatedSearch.addEventListener('input', renderRelatedOptions);
relatedSearch.addEventListener('focus', renderRelatedOptions);
document.addEventListener('pointerdown', (event) => {
  if (!(event.target instanceof Node)) return;
  if (!relatedSearch.contains(event.target) && !relatedOptions.contains(event.target)) relatedOptions.hidden = true;
});

function createSlug(title: string): string {
  return createEnglishSlug(title, fSlugSource.value, currentCollection, fDate.value);
}

function uniqueSlug(base: string): string {
  const existing = loadedPosts
    .filter((post) => post.collection === currentCollection && post.id !== fOriginalSlug.value)
    .map((post) => post.id);
  return uniqueEnglishSlug(base, existing);
}

function updateAutomaticSlug() {
  if (isEditingExisting || slugManuallyEdited) return;
  fSlug.value = uniqueSlug(createSlug(fTitle.value));
}

fTitle.addEventListener('input', updateAutomaticSlug);
fSlugSource.addEventListener('input', updateAutomaticSlug);
fDate.addEventListener('change', updateAutomaticSlug);
fSlug.addEventListener('input', () => {
  if (!isEditingExisting) slugManuallyEdited = true;
});
document.getElementById('slug-generate-btn')?.addEventListener('click', () => {
  slugManuallyEdited = false;
  updateAutomaticSlug();
});

document.getElementById('category-add-btn')?.addEventListener('click', () => {
  const value = prompt('新增分類名稱：');
  if (!value?.trim()) return;
  const category = value.trim();
  if (!allCategories.includes(category)) allCategories.push(category);
  const option = new Option(category, category);
  if (![...fCategory.options].some((item) => item.value === category)) fCategory.add(option);
  fCategory.value = category;
});

function resetForm(collection: ContentKind = activeCollection === 'all' ? 'blog' : activeCollection) {
  applyCollectionForm(collection);
  isEditingExisting = false;
  wasPublishedBeforeEdit = false;
  fOriginalSlug.value = '';
  fSlug.value = '';
  fSlug.disabled = false;
  slugManuallyEdited = false;
  fTitle.value = '';
  fSlugSource.value = '';
  fDescription.value = '';
  const today = new Date();
  fDate.value = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  if (![...fCategory.options].some((option) => option.value === 'General'))
    fCategory.add(new Option('General', 'General'));
  fCategory.value = 'General';
  fType.value = '';
  fVolume.value = '';
  fChapter.value = '';
  fOrder.value = '';
  fIpa.value = '';
  fPos.value = '';
  fEtymology.value = '';
  currentRelated = [];
  fRelated.value = '';
  relatedSearch.value = '';
  relatedOptions.hidden = true;
  renderRelatedChips();
  currentTags = [];
  renderTagChips();
  fDraft.checked = true;
  fFeatured.checked = false;
  fNotify.checked = false;
  fNotifyWrap.style.display = 'none';
  fBody.value = '';
  deleteBtn.style.display = 'none';
  formMessage.textContent = '';
  formMessage.style.color = 'var(--muted)';
  const lintEl = document.getElementById('md-lint');
  if (lintEl) lintEl.style.display = 'none';
  setMarkdownView('editor');
  exitFocusWriting();
  updateMarkdownStats();
}

function dataString(data: Record<string, any>, key: string): string {
  const value = data[key];
  return value === undefined || value === null ? '' : String(value);
}

async function openEditor(collection: ContentKind, id: string) {
  if (!postsReady) await loadPosts();
  showEditor();
  applyCollectionForm(collection);
  const lintEl = document.getElementById('md-lint');
  if (lintEl) lintEl.style.display = 'none';
  setMarkdownView('editor');
  // Clear the previous entry's identity and values before the fetch. If the
  // request fails and the stale form stayed populated, saving would overwrite
  // whichever entry was open before.
  isEditingExisting = false;
  wasPublishedBeforeEdit = false;
  fOriginalSlug.value = '';
  fSlug.value = '';
  fSlug.disabled = false;
  currentTags = [];
  renderTagChips();
  currentRelated = [];
  fRelated.value = '';
  renderRelatedChips();
  relatedSearch.value = '';
  relatedOptions.hidden = true;
  fBody.value = '';
  fDraft.checked = true;
  deleteBtn.style.display = 'none';
  updateMarkdownStats();
  formMessage.style.color = 'var(--muted)';
  formMessage.textContent = '載入內容中…';
  try {
    const res = await fetch(`/api/admin/content/${collection}/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '載入失敗');
    const fm = data.data ?? {};

    isEditingExisting = true;
    wasPublishedBeforeEdit = !fm.draft;
    fOriginalSlug.value = id;
    currentCollection = collection;
    fSlug.value = id;
    fSlug.disabled = true;
    slugManuallyEdited = true;
    fTitle.value = collection === 'dictionary' ? dataString(fm, 'word') : dataString(fm, 'title');
    fSlugSource.value = '';
    fDescription.value = collection === 'dictionary' ? dataString(fm, 'definition') : dataString(fm, 'description');
    fDate.value = dataString(fm, 'date');
    const existingCategory = dataString(fm, 'category') || 'General';
    if (![...fCategory.options].some((option) => option.value === existingCategory)) {
      fCategory.add(new Option(existingCategory, existingCategory));
    }
    fCategory.value = existingCategory;
    fType.value = dataString(fm, 'type');
    fVolume.value = dataString(fm, 'volume');
    fChapter.value = dataString(fm, 'chapter');
    fOrder.value = dataString(fm, 'order');
    fIpa.value = dataString(fm, 'ipa');
    fPos.value = dataString(fm, 'partOfSpeech');
    fEtymology.value = dataString(fm, 'etymology');
    currentTags = Array.isArray(fm.tags) ? [...fm.tags] : [];
    const related = Array.isArray(fm.relatedLore)
      ? fm.relatedLore
      : Array.isArray(fm.relatedWords)
        ? fm.relatedWords
        : Array.isArray(fm.relatedEntries)
          ? fm.relatedEntries
          : [];
    currentRelated = [...new Set((related as unknown[]).map((value: unknown) => String(value)))];
    relatedSearch.value = '';
    renderRelatedChips();
    renderTagChips();
    fDraft.checked = Boolean(fm.draft);
    fFeatured.checked = Boolean(fm.featured);
    fNotify.checked = false;
    fNotifyWrap.style.display = wasPublishedBeforeEdit && collection === 'blog' ? 'flex' : 'none';
    fBody.value = data.body || '';
    updateMarkdownStats();
    deleteBtn.style.display = 'block';
    formMessage.textContent = '';
  } catch (err: any) {
    formMessage.textContent = err.message || '載入失敗';
    formMessage.style.color = 'var(--bad)';
  }
}

document.getElementById('new-post-btn')!.addEventListener('click', () => {
  resetForm();
  showEditor();
});
document.getElementById('back-btn')!.addEventListener('click', showList);

fDraft.addEventListener('change', () => {
  if (isEditingExisting && wasPublishedBeforeEdit && !fDraft.checked && currentCollection === 'blog') {
    fNotifyWrap.style.display = 'flex';
  } else {
    fNotifyWrap.style.display = 'none';
  }
});

document.getElementById('post-form')!.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  // Ctrl+S / Ctrl+Enter can fire while a save is in flight; the disabled flag
  // is the only guard because requestSubmit() bypasses a disabled submit button.
  if (saveBtn.disabled) return;
  saveBtn.disabled = true;
  addTagFromInput();
  formMessage.style.color = 'var(--muted)';
  formMessage.textContent = '儲存中…';

  const shared = {
    draft: fDraft.checked,
    featured: fFeatured.checked,
    tags: currentTags,
    body: fBody.value,
    notifyOnUpdate: fNotify.checked,
  };
  const data: Record<string, unknown> = { draft: fDraft.checked };
  if (currentCollection === 'blog') {
    Object.assign(data, {
      title: fTitle.value.trim(),
      description: fDescription.value.trim(),
      date: fDate.value,
      category: fCategory.value.trim() || 'General',
      tags: currentTags,
      featured: fFeatured.checked,
      type: fType.value.trim() || 'essay',
      author: 'Your Name',
    });
  } else if (currentCollection === 'novel') {
    Object.assign(data, {
      title: fTitle.value.trim(),
      description: fDescription.value.trim(),
      date: fDate.value,
      volume: fVolume.value.trim() || '第一卷',
      chapter: Number(fChapter.value),
      order: Number(fOrder.value || 0),
      relatedLore: currentRelated,
      tags: currentTags,
      author: 'Your Name',
    });
  } else if (currentCollection === 'dictionary') {
    Object.assign(data, {
      word: fTitle.value.trim(),
      definition: fDescription.value.trim(),
      ipa: fIpa.value.trim(),
      partOfSpeech: fPos.value.trim(),
      etymology: fEtymology.value.trim(),
      relatedWords: currentRelated,
    });
  } else {
    Object.assign(data, {
      title: fTitle.value.trim(),
      description: fDescription.value.trim(),
      type: fType.value.trim() || '概念',
      relatedEntries: currentRelated,
    });
  }

  const payload = {
    collection: currentCollection,
    id: fSlug.value.trim(),
    draft: shared.draft,
    body: shared.body,
    notifyOnUpdate: shared.notifyOnUpdate,
    data,
  };

  try {
    const url = isEditingExisting
      ? `/api/admin/content/${currentCollection}/${encodeURIComponent(fOriginalSlug.value)}`
      : '/api/admin/content';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || '儲存失敗');

    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    formMessage.style.color = 'var(--good)';
    formMessage.textContent = result.draft
      ? '草稿已儲存到 Cloudflare D1。'
      : result.notified?.ok
        ? '已發布，Discord 通知已送出。'
        : '已發布。';
    if (warnings.length > 0) {
      formMessage.textContent += ` 提示：${warnings.join('；')}`;
      formMessage.style.color = 'var(--warning)';
    }
    setTimeout(showList, 900);
  } catch (err: any) {
    formMessage.style.color = 'var(--bad)';
    formMessage.textContent = err.message || '儲存失敗';
  } finally {
    saveBtn.disabled = false;
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!confirm(`確定要刪除「${fTitle.value}」嗎?這個動作無法復原。`)) return;
  try {
    const res = await fetch(`/api/admin/content/${currentCollection}/${encodeURIComponent(fOriginalSlug.value)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '刪除失敗');
    showList();
  } catch (err: any) {
    formMessage.style.color = 'var(--bad)';
    formMessage.textContent = err.message || '刪除失敗';
  }
});

document.getElementById('logout-btn')!.addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

// ---- Image upload: compress client-side (canvas -> webp) before sending ---
const uploadBtn = document.getElementById('upload-btn')!;
const uploadInput = document.getElementById('upload-input') as HTMLInputElement;
const uploadStatus = document.getElementById('upload-status')!;

uploadBtn.addEventListener('click', () => uploadInput.click());

async function compressImage(file: File, maxDimension = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  return blob ?? file;
}

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files?.[0];
  if (!file) return;
  uploadStatus.textContent = '壓縮中…';
  try {
    const compressed = await compressImage(file);
    uploadStatus.textContent = '上傳中…';
    const form = new FormData();
    const ext = compressed.type === 'image/webp' ? 'webp' : file.name.split('.').pop() || 'jpg';
    form.append('file', compressed, `upload.${ext}`);

    const res = await fetch('/api/admin/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '上傳失敗');

    const cursor = fBody.selectionStart ?? fBody.value.length;
    const markdown = `![](${data.url})`;
    fBody.value = fBody.value.slice(0, cursor) + markdown + fBody.value.slice(cursor);
    fBody.focus();
    fBody.setSelectionRange(cursor + markdown.length, cursor + markdown.length);
    dispatchBodyInput();
    uploadStatus.textContent = '已插入圖片 ✓';
    setTimeout(() => (uploadStatus.textContent = ''), 2000);
  } catch (err: any) {
    uploadStatus.textContent = err.message || '上傳失敗';
  } finally {
    uploadInput.value = '';
  }
});

// ---- Markdown editor: formatting, keyboard ergonomics and view modes -----
function dispatchBodyInput() {
  fBody.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceSelection(insert: string, selectInserted = false) {
  const start = fBody.selectionStart;
  const end = fBody.selectionEnd;
  const before = fBody.value.slice(0, start);
  const after = fBody.value.slice(end);
  fBody.value = before + insert + after;
  const cursor = start + insert.length;
  fBody.focus();
  fBody.setSelectionRange(selectInserted ? start : cursor, selectInserted ? cursor : cursor);
  dispatchBodyInput();
}

function wrapSelection(prefix: string, suffix: string = prefix, placeholder = '文字') {
  const start = fBody.selectionStart;
  const end = fBody.selectionEnd;
  const selected = fBody.value.slice(start, end) || placeholder;
  const before = fBody.value.slice(0, start);
  const after = fBody.value.slice(end);
  fBody.value = before + prefix + selected + suffix + after;
  const selStart = start + prefix.length;
  fBody.focus();
  fBody.setSelectionRange(selStart, selStart + selected.length);
  dispatchBodyInput();
}

/** Toggle a line-leading marker on every selected line. */
function toggleLinePrefix(prefix: string) {
  const start = fBody.selectionStart;
  const end = fBody.selectionEnd;
  const value = fBody.value;
  const blockStart = value.lastIndexOf('\n', start - 1) + 1;
  const blockEndRaw = value.indexOf('\n', end);
  const blockEnd = blockEndRaw === -1 ? value.length : blockEndRaw;
  const block = value.slice(blockStart, blockEnd);
  const lines = block.split('\n');
  const allPrefixed = lines.every((line) => line.startsWith(prefix) || line.trim() === '');
  const nextBlock = lines
    .map((line) => (line.trim() === '' ? line : allPrefixed ? line.slice(prefix.length) : prefix + line))
    .join('\n');
  fBody.value = value.slice(0, blockStart) + nextBlock + value.slice(blockEnd);
  fBody.focus();
  fBody.setSelectionRange(blockStart, blockStart + nextBlock.length);
  dispatchBodyInput();
}

function insertOrderedList() {
  const start = fBody.selectionStart;
  const end = fBody.selectionEnd;
  const value = fBody.value;
  const blockStart = value.lastIndexOf('\n', start - 1) + 1;
  const blockEndRaw = value.indexOf('\n', end);
  const blockEnd = blockEndRaw === -1 ? value.length : blockEndRaw;
  const lines = value.slice(blockStart, blockEnd).split('\n');
  let number = 1;
  const nextBlock = lines
    .map((line) => (line.trim() === '' ? line : `${number++}. ${line.replace(/^\d+[.)]\s+/, '')}`))
    .join('\n');
  fBody.value = value.slice(0, blockStart) + nextBlock + value.slice(blockEnd);
  fBody.focus();
  fBody.setSelectionRange(blockStart, blockStart + nextBlock.length);
  dispatchBodyInput();
}

function insertMarkdownTable() {
  const table = ['| 欄位 1 | 欄位 2 | 欄位 3 |', '| --- | --- | --- |', '| 內容 | 內容 | 內容 |'].join('\n');
  const start = fBody.selectionStart;
  const prefix = start > 0 && fBody.value[start - 1] !== '\n' ? '\n\n' : '';
  replaceSelection(`${prefix}${table}\n`);
}

function insertLink() {
  const url = prompt('連結網址:', 'https://');
  if (!url) return;
  const start = fBody.selectionStart;
  const end = fBody.selectionEnd;
  const label = fBody.value.slice(start, end) || '連結文字';
  const insertion = `[${label}](${url})`;
  replaceSelection(insertion, false);
  fBody.setSelectionRange(start + 1, start + 1 + label.length);
}

function indentSelection(outdent = false) {
  const value = fBody.value;
  const start = fBody.selectionStart;
  const end = fBody.selectionEnd;
  const blockStart = value.lastIndexOf('\n', start - 1) + 1;
  const blockEndIndex = value.indexOf('\n', end);
  const blockEnd = blockEndIndex === -1 ? value.length : blockEndIndex;
  const block = value.slice(blockStart, blockEnd);
  const lines = block.split('\n');
  const adjusted = lines.map((line) => {
    if (outdent) return line.startsWith('  ') ? line.slice(2) : line.startsWith('\t') ? line.slice(1) : line;
    return `  ${line}`;
  });
  const nextBlock = adjusted.join('\n');
  fBody.value = value.slice(0, blockStart) + nextBlock + value.slice(blockEnd);
  const delta = nextBlock.length - block.length;
  fBody.focus();
  fBody.setSelectionRange(
    Math.max(blockStart, start + (outdent ? Math.min(0, delta) : 2)),
    Math.max(blockStart, end + delta),
  );
  dispatchBodyInput();
}

function runMarkdownTool(kind: string) {
  if (kind === 'bold') wrapSelection('**');
  else if (kind === 'italic') wrapSelection('*');
  else if (kind === 'strike') wrapSelection('~~');
  else if (kind === 'h1') toggleLinePrefix('# ');
  else if (kind === 'h2') toggleLinePrefix('## ');
  else if (kind === 'h3') toggleLinePrefix('### ');
  else if (kind === 'quote') toggleLinePrefix('> ');
  else if (kind === 'ul') toggleLinePrefix('- ');
  else if (kind === 'ol') insertOrderedList();
  else if (kind === 'task') toggleLinePrefix('- [ ] ');
  else if (kind === 'code') wrapSelection('`');
  else if (kind === 'codeblock') {
    const start = fBody.selectionStart;
    const end = fBody.selectionEnd;
    const selected = fBody.value.slice(start, end) || '在這裡輸入程式碼';
    const language = prompt('程式語言標記（可留空，例如 ts、python、json）：', '');
    if (language === null) return;
    const safeLanguage = language.trim().replace(/[^a-zA-Z0-9_+-]/g, '');
    const insertion = `\n\n\`\`\`${safeLanguage}\n${selected}\n\`\`\`\n\n`;
    replaceSelection(insertion, false);
    const contentStart = start + insertion.indexOf(selected);
    fBody.setSelectionRange(contentStart, contentStart + selected.length);
  } else if (kind === 'link') insertLink();
  else if (kind === 'hr') replaceSelection('\n\n---\n\n');
  else if (kind === 'table') insertMarkdownTable();
}

document.querySelectorAll<HTMLButtonElement>('[data-md]').forEach((btn) => {
  btn.addEventListener('click', () => runMarkdownTool(btn.dataset.md || ''));
});

// Smart Enter continues bullet, task and numbered lists, and exits an empty
// item. Tab / Shift+Tab indent and outdent the selected lines rather than
// moving browser focus away from the editor.
fBody.addEventListener('keydown', (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 's') {
    event.preventDefault();
    (document.getElementById('post-form') as HTMLFormElement).requestSubmit();
    return;
  }
  if (modifier && event.key === 'Enter') {
    event.preventDefault();
    (document.getElementById('post-form') as HTMLFormElement).requestSubmit();
    return;
  }
  if (modifier && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    wrapSelection('**');
    return;
  }
  if (modifier && event.key.toLowerCase() === 'i') {
    event.preventDefault();
    wrapSelection('*');
    return;
  }
  if (modifier && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    insertLink();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    indentSelection(event.shiftKey);
    return;
  }
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;

  const value = fBody.value;
  const position = fBody.selectionStart;
  if (position !== fBody.selectionEnd) return;
  const lineStart = value.lastIndexOf('\n', position - 1) + 1;
  const currentLine = value.slice(lineStart, position);
  const taskMatch = currentLine.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
  const bulletMatch = currentLine.match(/^(\s*)([-*+])\s+(?!\[[ xX]\]\s)(.*)$/);
  const orderedMatch = currentLine.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  const match = taskMatch || bulletMatch || orderedMatch;
  if (!match) return;

  const content = taskMatch ? taskMatch[4] : match[match.length - 1];
  event.preventDefault();
  if (content.trim() === '') {
    fBody.value = value.slice(0, lineStart) + value.slice(position);
    fBody.setSelectionRange(lineStart, lineStart);
  } else {
    const prefix = taskMatch
      ? `${taskMatch[1]}${taskMatch[2]} [ ] `
      : bulletMatch
        ? `${bulletMatch[1]}${bulletMatch[2]} `
        : `${orderedMatch![1]}${Number(orderedMatch![2]) + 1}${orderedMatch![3]} `;
    const insertion = `\n${prefix}`;
    fBody.value = value.slice(0, position) + insertion + value.slice(position);
    const nextPosition = position + insertion.length;
    fBody.setSelectionRange(nextPosition, nextPosition);
  }
  dispatchBodyInput();
});

// ---- Markdown preview + lint (same libraries/config as the local CMS) ---
const mdPreviewEl = document.getElementById('md-preview')!;
const mdLintEl = document.getElementById('md-lint')!;
const mdLintBtn = document.getElementById('md-lint-btn')!;
const mdWorkspace = document.getElementById('md-workspace')!;
const mdStats = document.getElementById('md-stats')!;
const mdFullscreenBtn = document.getElementById('md-fullscreen-btn')!;
let mdPreviewTimer: ReturnType<typeof setTimeout> | null = null;
let mdLintTimer: ReturnType<typeof setTimeout> | null = null;
let mdRequestId = 0;

type MarkdownView = 'editor' | 'split' | 'preview';

function updateMarkdownStats() {
  const value = fBody.value;
  const characters = Array.from(value.replace(/\s/g, '')).length;
  const lines = value.length === 0 ? 1 : value.split(/\r?\n/).length;
  mdStats.textContent = `${characters.toLocaleString()} 字 · ${lines.toLocaleString()} 行`;
}

function setMarkdownView(view: MarkdownView) {
  mdWorkspace.dataset.view = view;
  document.querySelectorAll<HTMLButtonElement>('[data-md-view]').forEach((button) => {
    const active = button.dataset.mdView === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (view !== 'editor') renderMarkdownPreview();
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    copied ? resolve() : reject(new Error('Clipboard unavailable'));
  });
}

function enhanceMarkdownBlocks(root: ParentNode) {
  root.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
    if (pre.dataset.mdEnhanced === 'true') return;
    pre.dataset.mdEnhanced = 'true';
    const code = pre.querySelector('code');
    if (!code) return;

    const language =
      [...code.classList]
        .find((name) => name.startsWith('language-'))
        ?.slice('language-'.length)
        .replace(/[^a-zA-Z0-9_+#.-]/g, '') || 'text';
    const bar = document.createElement('div');
    bar.className = 'markdown-code-toolbar';
    const label = document.createElement('span');
    label.className = 'markdown-code-language';
    label.textContent = language.toUpperCase();
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'markdown-code-copy';
    copyButton.textContent = '複製';
    copyButton.setAttribute('aria-label', '複製程式碼');
    copyButton.addEventListener('click', async () => {
      const original = copyButton.textContent || '複製';
      try {
        await copyText(code.textContent || '');
        copyButton.textContent = '已複製';
      } catch {
        copyButton.textContent = '複製失敗';
      }
      window.setTimeout(() => (copyButton.textContent = original), 1600);
    });
    bar.append(label, copyButton);
    pre.insertBefore(bar, pre.firstChild);
  });

  root.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
    const parent = table.parentElement;
    if (parent?.classList.contains('markdown-table-wrap')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-table-wrap';
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  });
}

function hydratePreviewLoreLinks(root: HTMLElement) {
  // Effective entries only: a D1 draft override replaces the published row in
  // loadedPosts above, so a dictionary entry whose draft is open still gets a
  // tooltip here instead of being dropped as "missing".
  const dictionary = new Map(
    loadedPosts.filter((post) => post.collection === 'dictionary').map((post) => [post.id, post.description] as const),
  );
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest('pre, code, a, script, style')) continue;
    if (node.nodeValue?.includes('[[')) nodes.push(node);
  }

  const pattern = /\[\[([A-Za-z0-9][A-Za-z0-9_-]*)\]\]/g;
  for (const node of nodes) {
    const value = node.nodeValue || '';
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(value))) {
      if (match.index > cursor) fragment.append(document.createTextNode(value.slice(cursor, match.index)));
      const id = match[1];
      const span = document.createElement('span');
      span.className = 'lore-word';
      span.dataset.loreWord = id;
      span.tabIndex = 0;
      span.textContent = id;
      const definition = dictionary.get(id);
      if (definition) span.dataset.tooltip = definition;
      else span.dataset.loreMissing = '';
      fragment.append(span);
      cursor = match.index + match[0].length;
    }
    if (cursor < value.length) fragment.append(document.createTextNode(value.slice(cursor)));
    node.replaceWith(fragment);
  }
}

function focusEditorLine(line: number, column = 1) {
  const lines = fBody.value.split(/\r?\n/);
  const safeLine = Math.max(1, Math.min(line, lines.length));
  let index = 0;
  for (let i = 0; i < safeLine - 1; i++) index += lines[i].length + 1;
  const lineText = lines[safeLine - 1] || '';
  const safeColumn = Math.max(1, Math.min(column, lineText.length + 1));
  const cursor = index + safeColumn - 1;
  fBody.focus();
  fBody.setSelectionRange(cursor, cursor);
}

async function renderMarkdownPreview() {
  const requestId = ++mdRequestId;
  mdPreviewEl.innerHTML = '<div class="md-preview-loading">正在產生預覽…</div>';
  try {
    // `async: false` selects marked's synchronous overload. Without it the
    // declared return type is `string | Promise<string>`, which is why
    // DOMPurify.sanitize rejected the value below. The old `headerIds` and
    // `mangle` options were removed in marked 18 and did nothing.
    const rawHtml = marked.parse(fBody.value, {
      async: false,
      gfm: true,
      breaks: false,
    });
    const html = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel'],
    });
    if (requestId !== mdRequestId) return;
    mdPreviewEl.innerHTML = html || '<div class="md-preview-empty">(沒有可預覽內容)</div>';
    hydratePreviewLoreLinks(mdPreviewEl);
    enhanceMarkdownBlocks(mdPreviewEl);
    mdPreviewEl.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
      try {
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
      } catch {
        // Keep malformed URLs sanitized without adding navigation attributes.
      }
    });
    mdPreviewEl.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      img.loading = 'lazy';
      img.decoding = 'async';
    });
  } catch (err: any) {
    if (requestId !== mdRequestId) return;
    mdPreviewEl.innerHTML = `<div class="md-preview-error">預覽失敗：${escapeHtml(err.message || '')}</div>`;
  }
}

function lintMarkdown() {
  try {
    const results = runMarkdownlint({
      strings: { content: fBody.value },
      config: {
        default: true,
        MD013: false,
        MD033: false,
        MD036: false,
        MD041: false,
      },
    });
    const issues = results.content || [];
    if (!issues.length) {
      mdLintEl.innerHTML = '<div class="md-lint-ok">✓ Markdown 通過檢查。</div>';
      return;
    }
    mdLintEl.innerHTML = issues
      .map((issue: any) => {
        const rule = issue.ruleNames?.[0] || 'Markdown';
        const detail = [issue.ruleDescription, issue.errorDetail].filter(Boolean).join(' · ');
        const context = issue.errorContext ? ` · ${issue.errorContext}` : '';
        const column = issue.errorRange?.[0] || 1;
        const severity = issue.severity === 'warning' ? 'warning' : 'error';
        return `<button type="button" class="md-issue ${severity}" data-line="${issue.lineNumber}" data-column="${column}"><span class="md-issue-line">第 ${issue.lineNumber} 行</span><span><strong>${escapeHtml(rule)}</strong> ${escapeHtml(detail + context)}</span></button>`;
      })
      .join('');
    mdLintEl.querySelectorAll<HTMLButtonElement>('.md-issue').forEach((b) => {
      b.addEventListener('click', () => focusEditorLine(Number(b.dataset.line) || 1, Number(b.dataset.column) || 1));
    });
  } catch (err: any) {
    mdLintEl.innerHTML = `<div class="md-lint-error">Markdown 檢查失敗：${escapeHtml(err.message || '')}</div>`;
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-md-view]').forEach((button) => {
  button.addEventListener('click', () => setMarkdownView(button.dataset.mdView as MarkdownView));
});

const markdownFormRow = document.querySelector<HTMLElement>('.markdown-form-row');

/** Leave the full-screen writing overlay, restoring the button state. */
function exitFocusWriting() {
  if (!markdownFormRow?.classList.contains('is-focused')) return;
  markdownFormRow.classList.remove('is-focused');
  mdFullscreenBtn.setAttribute('aria-pressed', 'false');
  mdFullscreenBtn.textContent = '專注寫作';
}

mdFullscreenBtn.addEventListener('click', () => {
  const active = markdownFormRow?.classList.toggle('is-focused') ?? false;
  mdFullscreenBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  mdFullscreenBtn.textContent = active ? '退出專注' : '專注寫作';
  if (active) fBody.focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') exitFocusWriting();
});

mdLintBtn.addEventListener('click', () => {
  const opening = mdLintEl.style.display === 'none';
  mdLintEl.style.display = opening ? 'block' : 'none';
  if (opening) lintMarkdown();
});
fBody.addEventListener('input', () => {
  updateMarkdownStats();
  if (mdLintTimer) clearTimeout(mdLintTimer);
  if (mdPreviewTimer) clearTimeout(mdPreviewTimer);
  if (mdLintEl.style.display !== 'none') mdLintTimer = setTimeout(lintMarkdown, 450);
  if (mdWorkspace.dataset.view !== 'editor') mdPreviewTimer = setTimeout(renderMarkdownPreview, 250);
});

resetForm();
setMarkdownView('editor');
updateMarkdownStats();
loadPosts();
loadTagsAndCategories();

// ---- Passkey enrollment ----------------------------------------------------
const passkeySetupButton = document.getElementById('passkey-setup-btn') as HTMLButtonElement | null;

function decodeWebAuthnBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeWebAuthnBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseCreationOptions(options: Record<string, any>): PublicKeyCredentialCreationOptions {
  // The wire format is the JSON form of the creation options. Converting the
  // binary fields is all this helper has to do; every required member the type
  // demands (rp, pubKeyCredParams, authenticatorSelection, …) is already in
  // `options` and passed through untouched, so the assertion is confined here.
  const converted = {
    ...options,
    challenge: decodeWebAuthnBase64Url(options.challenge),
    user: { ...options.user, id: decodeWebAuthnBase64Url(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((item: any) => ({
      ...item,
      id: decodeWebAuthnBase64Url(item.id),
    })),
  };
  return converted as unknown as PublicKeyCredentialCreationOptions;
}

function serializeAttestation(credential: PublicKeyCredential): Record<string, any> {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: encodeWebAuthnBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: encodeWebAuthnBase64Url(response.clientDataJSON),
      attestationObject: encodeWebAuthnBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

async function refreshPasskeyStatus() {
  if (!passkeySetupButton) return;
  try {
    const response = await fetch('/api/admin/passkeys', { cache: 'no-store', credentials: 'same-origin' });
    const data = await response.json();
    if (response.ok && data.ok) {
      passkeySetupButton.textContent = data.count > 0 ? `Passkey · ${data.count} 把` : '設定 Passkey';
      passkeySetupButton.title = data.count > 0 ? '新增一把 Passkey' : '登記第一把 Passkey，以後可用裝置解鎖登入';
    }
  } catch {
    // Keep the fallback label; the management UI remains usable.
  }
}

passkeySetupButton?.addEventListener('click', async () => {
  if (!('PublicKeyCredential' in window) || !navigator.credentials?.create) {
    window.alert('目前瀏覽器不支援 Passkey。請改用支援 WebAuthn 的現代瀏覽器。');
    return;
  }

  const previousLabel = passkeySetupButton.textContent || '設定 Passkey';
  passkeySetupButton.disabled = true;
  passkeySetupButton.textContent = '準備中…';

  try {
    const optionsResponse = await fetch('/api/admin/passkey/register-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const optionsData = await optionsResponse.json();
    if (!optionsResponse.ok || !optionsData.ok || !optionsData.options) {
      throw new Error(optionsData.error || '無法建立 Passkey 註冊請求。');
    }

    passkeySetupButton.textContent = '請完成裝置驗證…';
    const credential = await navigator.credentials.create({
      publicKey: parseCreationOptions(optionsData.options),
    });
    if (!credential) throw new Error('已取消 Passkey 註冊。');

    const verifyResponse = await fetch('/api/admin/passkey/register-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: serializeAttestation(credential as PublicKeyCredential) }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const verifyData = await verifyResponse.json();
    if (!verifyResponse.ok || !verifyData.ok) throw new Error(verifyData.error || 'Passkey 註冊失敗。');

    window.alert('Passkey 已成功登記。下次登入時，系統會優先使用 Passkey。');
    await refreshPasskeyStatus();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'Passkey 註冊失敗，請再試一次。');
  } finally {
    passkeySetupButton.disabled = false;
    if (passkeySetupButton.textContent === '準備中…' || passkeySetupButton.textContent === '請完成裝置驗證…') {
      passkeySetupButton.textContent = previousLabel;
    }
  }
});

void refreshPasskeyStatus();
