# Fluent UI Design & Motion Guidelines for Astro

**版本：1.1（AI Agent Edition）**  
**定位：Astro Web 的 Windows 11 / WinUI 3 / Fluent-inspired Design System**  
**用途：設計、開發、Code Review、AI Agent Implementation Reference**

> 本文件不是 Microsoft WinUI 3 的 Web 移植版，也不是要求 Astro 使用 XAML、WinAppSDK 或 WinUI Runtime。
>
> 它是一套把 Fluent / Windows motion、material、depth、geometry、interaction principles 轉化為 Web-native 規則的設計規範。
>
> 參考 Fluent 2、Windows Design Guidelines 與 WinUI motion guidance；具體 Web token 與 CSS 實作為本網站的適配值，而不是 Microsoft 官方 token 的一對一複製。

**1.1 版變更**：修正内文殘留的破損引用標記；新增〈如何使用本文件〉、Table of Contents、§81 Token 快查表、§82 送出前檢查清單、§83 Agent 常見失誤模式、§84 機器可讀 Rule Manifest，讓 AI Agent 能更快定位規則、以一致語意解讀「必須／應／可以／禁止」，並在修改前後有可勾選的驗證步驟。原有 §0–§80 內容與規則本身未變動。

---

## 如何使用本文件（AI Agent 使用說明）

本文件共 81 個章節（§0–§80），加上本次新增的 §81–§84，總計 85 個章節，篇幅較長。AI Agent **不應該每次任務都把全文塞進 context**，而應該用下面的策略讀取：

### 規範語意（Normative Keywords）

本文件用中文書寫，但語氣強度是有意義的，請依下表解讀，等同 RFC 2119 的 MUST / SHOULD / MAY：

| 文中用語 | 等同語意 | Agent 應對方式 |
|---|---|---|
| 必須、不得、禁止 | **MUST / MUST NOT** | 沒有例外，違反視為 bug，不可因為「看起來更漂亮」而略過 |
| 應、推薦、優先 | **SHOULD** | 預設遵守；若有明確、可陳述的理由要偏離，需在 PR / commit message 中說明原因 |
| 可以、可 | **MAY** | 視情境選用，不遵守不算錯誤 |
| 不要、避免 | **SHOULD NOT**（若同段落出現「禁止」則視為 MUST NOT） | 預設不做；只有在有明確設計理由時才考慮 |
| 除非 / 除非有明確理由 | 條件例外 | 例外必須是「明確、可陳述」的理由，不能是「我覺得比較好看」 |

### Agent 建議的讀取順序

1. **一定先讀**：§0（Design North Star）、§61（Motion Decision Tree）、§70–§72（AI Agent Implementation Rules / 修改優先級 / Dependency Rule）。這些定義了「動不動、怎麼動、要不要裝套件」的最高層判斷。
2. **依任務跳讀**：用下方 Table of Contents 直接定位到相關 component（例如改 Dropdown 就讀 §22–§23，改 Dialog 就讀 §24），不需要通篇閱讀。
3. **查數值一律用 §81**：不要在 §3/§4/§11/§12/§53 等分散段落裡重新推導數值，§81 是唯一 source of truth，若正文其他段落與 §81 數值不一致，以 §81 為準。
4. **送出修改前**：逐項核對 §82 Pre-Change Checklist。
5. **懷疑自己是不是踩到常見錯誤**：對照 §83。
6. **需要程式化解析 token / 規則**：讀 §84 的 YAML manifest，不需要重新解析 Markdown 散文。

### 衝突解決順序

當具體 component 規則（例如 §22 Dropdown 的動畫）與通用原則（例如 §9 Motion Principles）看似衝突時：

```text
具體 component 規則
   優先於
通用原則
   但
Accessibility（§41 §42 §43）
Golden Rules（§78）
   永遠優先於兩者
```

也就是說，越具體的規則可以覆蓋越通用的規則，但無障礙與 §78 的 12 條 Golden Rules 是不可被覆蓋的底線。

### Table of Contents

<details>
<summary>展開完整章節列表（§0–§80）</summary>

- [0. Design North Star](#0-design-north-star)
- [1. Fluent Design Principles](#1-fluent-design-principles)
- [2. Visual Language](#2-visual-language)
- [3. Geometry](#3-geometry)
- [4. Spacing](#4-spacing)
- [5. Material](#5-material)
- [6. Transparency Rules](#6-transparency-rules)
- [7. Elevation & Depth](#7-elevation-depth)
- [8. Stacking Context](#8-stacking-context)
- [9. Motion Principles](#9-motion-principles)
- [10. Motion Vocabulary](#10-motion-vocabulary)
- [11. Duration](#11-duration)
- [12. Easing](#12-easing)
- [13. Easing Selection](#13-easing-selection)
- [14. Enter Motion](#14-enter-motion)
- [15. Exit Motion](#15-exit-motion)
- [16. Hover Motion](#16-hover-motion)
- [17. Press Motion](#17-press-motion)
- [18. Elevation Motion](#18-elevation-motion)
- [19. Fluent Card](#19-fluent-card)
- [20. Button](#20-button)
- [21. Focus](#21-focus)
- [22. Dropdown / ComboBox](#22-dropdown-combobox)
- [23. Dropdown Choreography](#23-dropdown-choreography)
- [24. Dialog](#24-dialog)
- [25. Tooltip](#25-tooltip)
- [26. Accordion](#26-accordion)
- [27. Navigation](#27-navigation)
- [28. Connected Motion](#28-connected-motion)
- [29. Astro View Transitions](#29-astro-view-transitions)
- [30. Scroll Reveal](#30-scroll-reveal)
- [31. Scroll Reveal Rules](#31-scroll-reveal-rules)
- [32. Choreography](#32-choreography)
- [33. Hierarchy](#33-hierarchy)
- [34. Animated Icons](#34-animated-icons)
- [35. Loading](#35-loading)
- [36. Skeleton](#36-skeleton)
- [37. Pointer Highlight](#37-pointer-highlight)
- [38. Performance](#38-performance)
- [39. `will-change`](#39-will-change)
- [40. requestAnimationFrame](#40-requestanimationframe)
- [41. Reduced Motion](#41-reduced-motion)
- [42. JavaScript Reduced Motion](#42-javascript-reduced-motion)
- [43. Accessibility Motion](#43-accessibility-motion)
- [44. Mobile](#44-mobile)
- [45. Responsive Motion](#45-responsive-motion)
- [46. Astro Architecture](#46-astro-architecture)
- [47. CSS Token Architecture](#47-css-token-architecture)
- [48. Component State Model](#48-component-state-model)
- [49. State Transition Rule](#49-state-transition-rule)
- [50. Fluent Select 完整規範](#50-fluent-select-完整規範)
- [51. Fancy Select Overlay Rule](#51-fancy-select-overlay-rule)
- [52. Surface Consistency](#52-surface-consistency)
- [53. Shadow System](#53-shadow-system)
- [54. Dark Mode](#54-dark-mode)
- [55. Light Mode](#55-light-mode)
- [56. Typography](#56-typography)
- [57. Content First](#57-content-first)
- [58. Loading Strategy](#58-loading-strategy)
- [59. No `transition: all`](#59-no-transition-all)
- [60. Animation Matrix](#60-animation-matrix)
- [61. Motion Decision Tree](#61-motion-decision-tree)
- [62. Do / Don't](#62-do-dont)
- [63. Performance Philosophy](#63-performance-philosophy)
- [64. Astro Lifecycle](#64-astro-lifecycle)
- [65. Event Management](#65-event-management)
- [66. IntersectionObserver](#66-intersectionobserver)
- [67. Web Animation API](#67-web-animation-api)
- [68. View Transition API](#68-view-transition-api)
- [69. Progressive Enhancement](#69-progressive-enhancement)
- [70. AI Agent Implementation Rules](#70-ai-agent-implementation-rules)
- [71. AI Agent 修改優先級](#71-ai-agent-修改優先級)
- [72. Dependency Rule](#72-dependency-rule)
- [73. Testing](#73-testing)
- [74. Browser Testing](#74-browser-testing)
- [75. Accessibility Testing](#75-accessibility-testing)
- [76. Performance Testing](#76-performance-testing)
- [77. Final Quality Bar](#77-final-quality-bar)
- [78. Fluent Web Golden Rules](#78-fluent-web-golden-rules)
- [79. Reference Mapping](#79-reference-mapping)
- [80. Final Design Philosophy](#80-final-design-philosophy)

</details>

---

# 0. Design North Star

網站的目標不是：

> 「加很多 Windows 11 動畫。」

而是：

> **讓使用者感覺 UI 有層次、有重量、有連續性，而且每個動畫都有目的。**

Fluent Motion 的核心可以概括為：

```text
Functional
Natural
Consistent
Appealing
```

Fluent 官方將 motion 定義為幫助使用者理解 UI 狀態、方向與關係的工具，而不是單純裝飾。

因此：

```text
Motion ≠ Decoration
Motion = Information + Feedback + Continuity
```

---

# 1. Fluent Design Principles

## 1.1 Natural on every platform

Web 不是 Windows Desktop。

因此：

- 使用 Web 原生 interaction pattern。
- 保留 Astro 的 rendering architecture。
- 不模擬不存在於瀏覽器中的 WinUI API。
- 在 Windows 上可以具有 Windows 11 的視覺語言。
- 在 macOS / Linux / mobile 上仍然應該是一個正常的 Web UI。

Fluent 官方也強調 experience 應該適應使用者所在的平台。

---

## 1.2 Built for focus

動畫不應該搶走內容的注意力。

優先順序：

```text
Content
  ↓
Interaction
  ↓
Context
  ↓
Decoration
```

如果一個動畫很漂亮，但讓使用者不知道自己剛才點了什麼：

**移除動畫。**

---

## 1.3 One for all

所有互動都必須考慮：

- keyboard
- screen reader
- reduced motion
- touch
- mouse
- small screens
- low-power devices

Fluent motion guidance 明確要求提供 no-motion experience，並避免突然、閃爍或可能造成不適的動作。

---

## 1.4 Unmistakably Fluent

網站可以具有：

- rounded geometry
- translucent surfaces
- subtle depth
- restrained motion
- clear hierarchy
- responsive feedback

但不要變成：

```text
Everything floats
Everything glows
Everything bounces
Everything blurs
Everything animates
```

這不是 Fluent。

---

# 2. Visual Language

Fluent UI 的視覺語言由幾個互相配合的維度構成：

```text
Geometry
Material
Light
Depth
Motion
Typography
Iconography
Layout
```

Windows design guidelines 也將 elevation、geometry、layout、materials、motion、navigation、typography 等列為核心設計領域。

---

# 3. Geometry

## 3.1 Corner Radius

推薦建立 semantic radius，而不是每個 component 自己設定。

```css
:root {
  --fluent-radius-xs: 4px;
  --fluent-radius-sm: 6px;
  --fluent-radius-md: 8px;
  --fluent-radius-lg: 12px;
  --fluent-radius-xl: 16px;
  --fluent-radius-2xl: 20px;
}
```

推薦：

| Component | Radius |
|---|---:|
| Badge | 999px / pill |
| Small control | 6–8px |
| Button | 6–8px |
| Input | 6–8px |
| Card | 12–16px |
| Dialog | 16px |
| Large surface | 16–20px |
| Avatar | 50% |

### 原則

相鄰元件應使用相關 radius。

不要：

```text
Button = 4px
Input = 17px
Card = 31px
Dialog = 3px
```

除非有明確設計理由。

---

# 4. Spacing

Fluent layout 使用 spacing 建立群組關係與 hierarchy；距離越近，使用者越容易理解它們屬於同一組。

建立基礎 spacing：

```css
:root {
  --fluent-space-1: 4px;
  --fluent-space-2: 8px;
  --fluent-space-3: 12px;
  --fluent-space-4: 16px;
  --fluent-space-5: 20px;
  --fluent-space-6: 24px;
  --fluent-space-8: 32px;
  --fluent-space-10: 40px;
  --fluent-space-12: 48px;
  --fluent-space-16: 64px;
}
```

不要為每個 component 發明：

```css
margin-top: 13px;
margin-left: 19px;
padding: 27px;
```

如果不是特殊 optical adjustment，優先使用 token。

---

# 5. Material

Fluent material 的目的不是「讓背景透明」。

Material 應該回答：

> 這個 surface 在 UI hierarchy 中處於什麼位置？

推薦三種 Web surface：

```text
Solid
Translucent
Elevated / Overlay
```

---

## 5.1 Solid Surface

普通 content：

```css
.fluent-surface {
  background: var(--surface);
}
```

---

## 5.2 Translucent Surface

適合：

- navigation
- card
- toolbar
- sticky header

```css
.fluent-surface-translucent {
  background:
    color-mix(
      in srgb,
      var(--surface) 78%,
      transparent
    );

  backdrop-filter:
    blur(20px)
    saturate(140%);
}
```

必須 fallback：

```css
@supports not (backdrop-filter: blur(1px)) {
  .fluent-surface-translucent {
    background: var(--surface);
  }
}
```

---

## 5.3 Overlay Surface

適合：

- dropdown
- flyout
- menu
- tooltip
- dialog

Overlay 不應與普通 card 使用完全相同的 material。

通常：

```text
Overlay
+ higher opacity
+ stronger border
+ stronger shadow
+ higher elevation
```

---

# 6. Transparency Rules

透明不是越多越 Fluent。

禁止：

```text
opacity: 0.3
```

讓文字直接疊在複雜背景上。

優先：

```text
Surface
  +
Contrast
  +
Blur
  +
Border
```

透明 surface 必須保證：

- text contrast
- focus visibility
- separation from background
- readability

---

# 7. Elevation & Depth

Fluent 使用 elevation 表達 hierarchy。

建立 semantic layers：

```css
:root {
  --fluent-layer-base: 0;
  --fluent-layer-content: 10;
  --fluent-layer-sticky: 100;
  --fluent-layer-dropdown: 1000;
  --fluent-layer-flyout: 1100;
  --fluent-layer-dialog: 2000;
  --fluent-layer-toast: 3000;
}
```

這些數值是本網站的 implementation convention。

---

## 7.1 Depth hierarchy

```text
Base
 ↓
Card
 ↓
Floating Card
 ↓
Dropdown / Flyout
 ↓
Dialog
 ↓
Toast / System Feedback
```

影子應該隨 elevation 增強，而不是所有東西都使用同一個 shadow。

---

# 8. Stacking Context

`z-index` 不是唯一決定因素。

以下 property 可能建立新的 stacking context：

```text
transform
filter
backdrop-filter
opacity < 1
isolation
contain
```

因此：

```css
z-index: 999999;
```

不代表一定能讓 dropdown 出現在最上面。

---

## 8.1 Overlay Architecture

推薦：

```html
<body>
  <main id="app">
    ...
  </main>

  <div id="overlay-root"></div>
</body>
```

需要跨越 card / section / clipping boundary 的 UI：

```text
Dropdown
Flyout
Dialog
Toast
```

優先放進 top-level overlay layer。

---

# 9. Motion Principles

Fluent motion 官方核心：

```text
Functional
Natural
Consistent
Appealing
```

並強調 duration、easing、transition choreography、hierarchy。

---

# 10. Motion Vocabulary

本系統使用：

```text
Enter
Exit
Elevate
Press
Reveal
Dismiss
Expand
Collapse
Transform
Connect
Navigate
```

每一種 motion 都有自己的目的。

---

# 11. Duration

WinUI 官方 guidance 使用 83ms、167ms、250ms、333ms 等平台動畫 duration。

Web adaptation：

```css
:root {
  --fluent-duration-instant: 83ms;
  --fluent-duration-fast: 167ms;
  --fluent-duration-normal: 250ms;
  --fluent-duration-emphasis: 333ms;
}
```

---

## 11.1 Duration selection

| Motion | Recommended |
|---|---:|
| Press feedback | 83–120ms |
| Hover | 100–167ms |
| Tooltip | 100–167ms |
| Dropdown | 167–250ms |
| Flyout | 167–250ms |
| Dialog | 200–333ms |
| Page transition | 167–250ms |
| Connected animation | 250–333ms |

不是所有動畫都必須使用完整 duration。

---

# 12. Easing

推薦：

```css
:root {
  --fluent-ease-decelerate:
    cubic-bezier(0, 0, 0, 1);

  --fluent-ease-standard:
    cubic-bezier(0.55, 0.55, 0, 1);

  --fluent-ease-accelerate:
    cubic-bezier(1, 0, 1, 1);

  --fluent-ease-linear: linear;
}
```

Windows guidance 對 Direct Entrance、Existing Elements、Direct Exit 等 motion purpose 使用不同 easing；exit 通常與 fade-out 結合。

---

# 13. Easing Selection

## Enter

使用：

```css
var(--fluent-ease-decelerate)
```

因為元素需要「進入並穩定」。

---

## Existing Element

使用：

```css
var(--fluent-ease-standard)
```

適合：

- resize
- reposition
- state change

---

## Exit

使用：

```css
var(--fluent-ease-accelerate)
```

並通常搭配：

```text
opacity → 0
```

---

## Linear

只用於：

- rotation
- progress
- continuous mechanical motion

不要將 linear 作為普通 UI enter/exit。

---

# 14. Enter Motion

標準 Fluent Web enter：

```text
Opacity
+
Small translation
+
Optional small scale
```

推薦：

```css
.from-enter {
  opacity: 0;
  transform:
    translateY(6px)
    scale(0.985);
}

.to-enter {
  opacity: 1;
  transform:
    translateY(0)
    scale(1);
}
```

不要：

```text
translateY(100px)
scale(0.7)
rotate(10deg)
```

除非這是特殊 hero animation。

---

# 15. Exit Motion

Exit 應比 Enter 快。

例如：

```text
Enter: 250ms
Exit: 167ms
```

這使 UI 感覺 responsive。

---

# 16. Hover Motion

Hover 是 feedback，不是 entrance。

推薦：

```css
.interactive {
  transition:
    transform 167ms var(--fluent-ease-standard),
    box-shadow 167ms var(--fluent-ease-standard),
    background-color 167ms var(--fluent-ease-standard);
}

.interactive:hover {
  transform: translateY(-1px);
}
```

---

# 17. Press Motion

Press 應該是短暫的。

```css
.interactive:active {
  transform: scale(0.98);
}
```

不要使用：

```css
scale(0.90);
```

除非 component 本身非常大型。

---

# 18. Elevation Motion

Hover 可以改變 elevation：

```text
Rest
  ↓
Hover
  ↓
Elevated
```

例如：

```css
.card {
  box-shadow: var(--shadow-1);
}

.card:hover {
  box-shadow: var(--shadow-2);
  transform: translateY(-2px);
}
```

但不要同時：

```text
scale
rotate
translate
blur
glow
shadow
```

全部動畫。

---

# 19. Fluent Card

Card 的標準狀態：

```text
Rest
Hover
Pressed
Focus
Disabled
```

推薦：

```css
.card {
  border-radius: var(--fluent-radius-lg);

  transition:
    transform 167ms var(--fluent-ease-standard),
    box-shadow 167ms var(--fluent-ease-standard),
    background-color 167ms var(--fluent-ease-standard);
}

.card:hover {
  transform: translateY(-2px);
}

.card:active {
  transform: translateY(0) scale(0.99);
}
```

---

# 20. Button

Button：

```text
Rest
Hover
Pressed
Focus
Disabled
```

推薦：

```css
.button {
  transition:
    transform 100ms var(--fluent-ease-standard),
    background-color 167ms var(--fluent-ease-standard);
}

.button:hover {
  transform: translateY(-1px);
}

.button:active {
  transform: scale(0.98);
}
```

---

# 21. Focus

Focus 不應被 hover animation 取代。

```css
:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
```

Focus ring 應：

- 明顯
- 穩定
- 不閃爍
- 不依賴動畫

---

# 22. Dropdown / ComboBox

Fluent-style dropdown：

```text
Closed
 ↓
Fade + Scale + Translate
 ↓
Open
```

```css
.fluent-dropdown {
  opacity: 0;
  visibility: hidden;

  transform:
    translateY(-4px)
    scale(0.98);

  transform-origin: top center;

  transition:
    opacity 167ms var(--fluent-ease-decelerate),
    transform 167ms var(--fluent-ease-decelerate),
    visibility 0s linear 167ms;
}

.fluent-dropdown[data-open="true"] {
  opacity: 1;
  visibility: visible;

  transform:
    translateY(0)
    scale(1);

  transition:
    opacity 167ms var(--fluent-ease-decelerate),
    transform 250ms var(--fluent-ease-decelerate),
    visibility 0s;
}
```

---

# 23. Dropdown Choreography

Parent 先出現：

```text
Surface
 ↓
Items
```

如果需要 stagger：

```text
Item 1: 0ms
Item 2: 20ms
Item 3: 40ms
Item 4: 60ms
```

不要：

```text
0
100
200
300
400
```

否則 menu 會變慢。

Fluent guidance 建議使用短 offset 的 stagger，並避免讓整體動畫因 stagger 過度延長。

---

# 24. Dialog

Dialog hierarchy：

```text
Page
 ↓
Backdrop
 ↓
Dialog
 ↓
Dialog Content
```

Backdrop：

```css
.dialog-backdrop {
  opacity: 0;
  transition:
    opacity 167ms var(--fluent-ease-standard);
}
```

Panel：

```css
.dialog-panel {
  opacity: 0;

  transform:
    translateY(8px)
    scale(0.985);

  transition:
    opacity 250ms var(--fluent-ease-decelerate),
    transform 250ms var(--fluent-ease-decelerate);
}
```

---

# 25. Tooltip

Tooltip 不應使用大型 animation。

```css
.tooltip {
  opacity: 0;
  transform: translateY(2px);

  transition:
    opacity 100ms var(--fluent-ease-standard),
    transform 100ms var(--fluent-ease-standard);
}

.tooltip[data-visible="true"] {
  opacity: 1;
  transform: translateY(0);
}
```

---

# 26. Accordion

Expand：

```text
Collapsed
 ↓
Content becomes visible
 ↓
Height / clip changes
```

如果可能，優先使用 grid：

```css
.accordion-content {
  display: grid;
  grid-template-rows: 0fr;

  transition:
    grid-template-rows 250ms var(--fluent-ease-standard);
}

.accordion[data-open="true"] .accordion-content {
  grid-template-rows: 1fr;
}

.accordion-inner {
  overflow: hidden;
}
```

避免大量 JS 計算高度。

---

# 27. Navigation

Top-level navigation 是高層級 transition。

Fluent motion guidance 建議 top-level navigation 使用快速 fade，而不是讓整個頁面大幅滑動。

推薦：

```text
Page A
fade out
↓
Page B
fade in
```

避免：

```text
Page A → 100vw slide
Page B ← 100vw slide
```

除非使用者明確理解這是 spatial navigation。

---

# 28. Connected Motion

當兩個頁面存在明確相同物件：

```text
Blog Card
      ↓
Blog Article
```

可以讓：

```text
Thumbnail
Title
```

產生 connected transition。

Windows 的 connected animation 用來強化兩個 view 之間的關係，讓使用者理解「這個頁面就是剛才選中的那個東西」。

Web implementation 優先：

```text
View Transition API
        ↓
FLIP
        ↓
simple fade
```

---

# 29. Astro View Transitions

如果網站使用 Astro ClientRouter / View Transitions：

優先使用 Astro / browser native transition。

不要自行：

```js
setTimeout(() => {
  location.href = ...
}, 500);
```

因為 navigation 不應被 animation 阻塞。

---

# 30. Scroll Reveal

Scroll reveal 的目的：

> 幫助使用者理解內容 hierarchy。

不是：

> 讓每個元素從天上飛進來。

推薦：

```css
.reveal {
  opacity: 0;
  transform: translateY(12px);

  transition:
    opacity 250ms var(--fluent-ease-decelerate),
    transform 250ms var(--fluent-ease-decelerate);
}

.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}
```

---

# 31. Scroll Reveal Rules

推薦：

```text
Distance: 8–16px
Duration: 167–333ms
```

不要：

```text
Distance: 200px
Duration: 1s
```

每個 section 不應有完全獨立的動畫節奏。

---

# 32. Choreography

動畫不是孤立事件。

例如：

```text
Page
 ↓
Hero
 ↓
Heading
 ↓
Description
 ↓
Primary Action
```

推薦：

```text
Hero       0ms
Heading   30ms
Body      60ms
Action    90ms
```

但是整體完成時間仍應保持短。

---

# 33. Hierarchy

重要元素：

```text
Primary action
Main title
Selected item
```

可以獲得較明顯 motion。

次要元素：

```text
Metadata
Secondary text
Decorative elements
```

使用較少 motion。

Fluent 官方把 animation hierarchy 視為引導注意力與降低導航混亂的重要部分。

---

# 34. Animated Icons

Icon motion 應該是：

```text
Small
Fast
Purposeful
```

例如：

```text
Chevron:
0° → 180°
```

推薦：

```css
.icon-chevron {
  transition:
    transform 167ms var(--fluent-ease-standard);
}

[data-open="true"] .icon-chevron {
  transform: rotate(180deg);
}
```

不要讓 icon：

```text
rotate 360°
bounce
shake
scale 1.5
```

除非它本身就是 feedback animation。

---

# 35. Loading

Loading animation 應該：

- 表示 progress / waiting
- 不造成視覺噪音
- 不使用高頻 flash

避免：

```text
infinite bouncing UI
```

Microsoft performance guidance 也建議謹慎使用 infinite animations，因為持續動畫會持續消耗 CPU。

---

# 36. Skeleton

Skeleton：

```text
Static shape
+
subtle shimmer
```

Shimmer 不是必要。

低功耗：

```text
No shimmer
```

優先於：

```text
Full-page animated shimmer
```

---

# 37. Pointer Highlight

可以使用 subtle radial highlight：

```css
.interactive-surface {
  --pointer-x: 50%;
  --pointer-y: 50%;

  background:
    radial-gradient(
      circle at var(--pointer-x) var(--pointer-y),
      rgb(255 255 255 / 0.08),
      transparent 35%
    );
}
```

只對：

```text
Card
Button
Navigation surface
```

使用。

不要全站追蹤 pointer。

---

# 38. Performance

Web implementation 必須優先動畫：

```text
transform
opacity
```

避免頻繁動畫：

```text
width
height
top
left
margin
padding
font-size
```

---

# 39. `will-change`

禁止：

```css
* {
  will-change: transform;
}
```

只在真的需要時：

```css
.card.is-animating {
  will-change: transform;
}
```

動畫完成後移除。

---

# 40. requestAnimationFrame

不要用：

```js
requestAnimationFrame(loop);
```

建立永遠運行的 UI animation，除非這是確實需要的 rendering task。

如果只是：

```text
hover
scroll reveal
dropdown
dialog
```

優先 CSS。

---

# 41. Reduced Motion

必須支援：

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

但是 reduced motion 不應等於：

```text
UI disappears
```

只移除 movement。

仍然保留：

```text
state
visibility
focus
hierarchy
```

---

# 42. JavaScript Reduced Motion

需要 JS animation 時：

```js
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;
```

如果：

```js
reduceMotion === true
```

則：

```text
No stagger
No parallax
No pointer animation
No connected animation
No unnecessary movement
```

---

# 43. Accessibility Motion

Animation 不應該是唯一的信息來源。

錯誤：

```text
紅色動畫 = error
```

正確：

```text
Error text
+
ARIA
+
visual state
+
optional motion
```

Fluent accessibility guidance 也指出，動畫所傳達的重要資訊應有其他方式提供，例如 ARIA live regions。

---

# 44. Mobile

Mobile：

```text
Less motion
Less blur
Less pointer effects
More direct feedback
```

不要在 mobile 模擬 desktop hover。

Touch feedback 優先：

```text
Tap
Press
Release
```

---

# 45. Responsive Motion

動畫 distance 應隨 viewport 調整。

Desktop：

```text
translateY(12px)
```

Mobile：

```text
translateY(6px)
```

大型 dialog：

Desktop：

```text
scale + translate
```

Mobile：

```text
bottom sheet / small translate
```

---

# 46. Astro Architecture

推薦：

```text
src/
├── components/
│   └── fluent/
│       ├── FluentButton.astro
│       ├── FluentCard.astro
│       ├── FluentSelect.astro
│       ├── FluentDialog.astro
│       └── FluentTooltip.astro
│
├── scripts/
│   └── fluent/
│       ├── motion.ts
│       ├── reveal.ts
│       └── navigation.ts
│
└── styles/
    ├── fluent-tokens.css
    ├── fluent-material.css
    ├── fluent-motion.css
    └── fluent-components.css
```

實際 repository 若已有 architecture：

**優先整合，而不是重建。**

---

# 47. CSS Token Architecture

推薦：

```text
Primitive
 ↓
Semantic
 ↓
Component
```

例如：

```css
--fluent-blue-500
        ↓
--color-accent
        ↓
--button-background
```

Motion：

```css
--fluent-duration-fast
        ↓
--motion-control
        ↓
--button-transition
```

---

# 48. Component State Model

所有 interactive components 優先建立：

```text
Rest
Hover
Focus
Pressed
Selected
Disabled
Loading
Open
```

不是每個 component 都需要所有 state。

---

# 49. State Transition Rule

State transition 應：

```text
predictable
short
reversible
```

例如：

```text
Closed → Open
Open → Closed
```

使用同一個 visual language。

---

# 50. Fluent Select 完整規範

Select：

```text
Rest
Hover
Focus
Pressed
Open
Option Hover
Option Selected
Disabled
```

Open animation：

```text
opacity
scale
translateY
```

Selected option：

```text
background
check icon
```

不要讓 selected item 大幅跳動。

---

# 51. Fancy Select Overlay Rule

特別規定：

```text
.fancy-select-list
```

必須位於 overlay hierarchy。

如果出現：

```text
Fancy Select
    ↓
Card
    ↓
Blog Preview
```

而 dropdown 被 card 擋住：

**不得直接增加 z-index 作為唯一修復。**

必須檢查：

```text
overflow
stacking context
transform
filter
backdrop-filter
contain
isolation
position
```

必要時使用：

```html
#overlay-root
```

---

# 52. Surface Consistency

以下 surfaces 不應使用完全不同的透明度：

```text
Card
Blog Preview
Select
Flyout
Dialog
Navigation
```

應建立：

```text
Surface hierarchy
```

例如：

```text
Base surface
Card surface
Elevated surface
Overlay surface
Dialog surface
```

---

# 53. Shadow System

建立：

```css
:root {
  --fluent-shadow-1:
    0 1px 3px rgb(0 0 0 / 0.12);

  --fluent-shadow-2:
    0 4px 12px rgb(0 0 0 / 0.14);

  --fluent-shadow-3:
    0 8px 24px rgb(0 0 0 / 0.18);

  --fluent-shadow-4:
    0 16px 40px rgb(0 0 0 / 0.22);
}
```

實際 shadow 必須配合網站 light/dark theme。

---

# 54. Dark Mode

Dark Fluent UI 不應只是：

```text
白色 → 黑色
```

需要重新考慮：

```text
surface
border
shadow
contrast
transparency
```

Dark mode 中 shadow 可能需要降低存在感，改由：

```text
border
contrast
surface separation
```

建立 hierarchy。

---

# 55. Light Mode

Light mode：

```text
Shadow
+
Border
+
Surface difference
```

三者不要全部拉滿。

否則 UI 會顯得厚重。

---

# 56. Typography

Typography hierarchy：

```text
Display
Title
Subtitle
Body
Caption
Metadata
```

不要用 animation 改變 font-size。

如果需要 hierarchy animation：

```text
opacity
transform
```

---

# 57. Content First

文字本身永遠優先於 motion。

錯誤：

```text
Animation
 ↓
content appears after 1 second
```

正確：

```text
Content immediately available
+
subtle enhancement
```

Animation 不應阻止使用者閱讀。

---

# 58. Loading Strategy

如果 server content 已經 ready：

不要：

```text
wait for animation
then show content
```

應：

```text
render content
+
animate presentation
```

---

# 59. No `transition: all`

禁止：

```css
transition: all 0.3s ease;
```

改成：

```css
transition:
  opacity 167ms var(--fluent-ease-standard),
  transform 167ms var(--fluent-ease-standard);
```

原因：

避免不必要 property 被動畫化，降低不可預期的 layout / rendering 成本。

---

# 60. Animation Matrix

| Component | Enter | Hover | Press | Exit |
|---|---|---|---|---|
| Button | None | Elevate | Scale | None |
| Card | Reveal | Elevate | Scale | Fade |
| Dropdown | Fade + Scale | Surface | None | Reverse |
| Flyout | Fade + Translate | Surface | None | Reverse |
| Dialog | Fade + Scale | None | None | Fade |
| Tooltip | Fade + Y | None | None | Fade |
| Accordion | Expand | Surface | None | Collapse |
| Page | Fade | None | None | Fade |
| Connected Card | Transform | Elevate | Scale | Connect |

---

# 61. Motion Decision Tree

當 Agent / Developer 想加入動畫時：

```text
Does motion communicate something?
        │
       NO
        ↓
     Don't add it
        │
       YES
        ↓
Is it interaction feedback?
        │
       YES
        ↓
   Use short motion
        │
       NO
        ↓
Is it navigation?
        │
       YES
        ↓
Fade / connected transition
        │
       NO
        ↓
Is it hierarchy?
        │
       YES
        ↓
Reveal / elevation
        │
       NO
        ↓
Probably unnecessary
```

---

# 62. Do / Don't

## Do

```text
✓ Small movement
✓ Clear purpose
✓ Short duration
✓ Consistent easing
✓ Surface hierarchy
✓ Reduced motion
✓ Keyboard support
✓ Responsive behavior
✓ Overlay architecture
✓ Native Web APIs
```

## Don't

```text
✗ Everything bounces
✗ Everything fades
✗ Everything scales
✗ Huge translation
✗ Long delays
✗ Infinite decorative animations
✗ transition: all
✗ z-index: 999999 as architecture
✗ JS animation for simple CSS transitions
✗ Ignore reduced motion
```

---

# 63. Performance Philosophy

WinUI guidance emphasizes smooth interaction and warns against unnecessary continuous animations.

Web version：

```text
Prefer compositor-friendly motion
        ↓
transform / opacity
        ↓
CSS transitions
        ↓
native browser APIs
        ↓
JS only when necessary
```

---

# 64. Astro Lifecycle

如果網站使用 Astro client navigation：

初始化應配合：

```js
document.addEventListener(
  "astro:page-load",
  () => {
    initFluentMotion();
  }
);
```

避免：

```text
page A listener
+
page B listener
+
page C listener
```

造成重複事件。

---

# 65. Event Management

不要：

```js
element.addEventListener(...)
```

每次 page navigation 都重複註冊。

使用：

```text
idempotent initialization
```

或：

```text
AbortController
```

管理 listener lifecycle。

---

# 66. IntersectionObserver

Scroll reveal：

```text
IntersectionObserver
```

優先於：

```text
scroll event + getBoundingClientRect()
```

因為 reveal 是 visibility problem，不是 continuous animation problem。

---

# 67. Web Animation API

適合：

```text
Connected animation
Dynamic animation
Runtime-calculated transform
Complex sequence
```

不適合：

```text
Button hover
Card hover
Simple dropdown
Simple tooltip
```

這些優先 CSS。

---

# 68. View Transition API

適合：

```text
Page navigation
Connected elements
Large state changes
```

必須 feature detect。

如果不支援：

```text
Normal navigation
```

仍然正常。

---

# 69. Progressive Enhancement

Fluent enhancement 必須遵守：

```text
No JS
 ↓
Functional HTML

CSS only
 ↓
Fluent visual

JS
 ↓
Enhanced motion

View Transition supported
 ↓
Connected motion
```

動畫永遠不能成為核心功能的依賴。

---

# 70. AI Agent Implementation Rules

AI Agent 在修改網站之前必須：

### Step 1

Audit：

```text
package.json
astro.config.*
src/layouts
src/components
src/pages
src/styles
```

### Step 2

找出：

```text
Navigation
Cards
Fancy Select
Dropdown
Dialog
Theme
View Transition
```

### Step 3

不要猜檔案。

### Step 4

先建立：

```text
Tokens
Materials
Elevation
Motion
Accessibility
```

### Step 5

再修改 components。

### Step 6

每一階段 build。

---

# 71. AI Agent 修改優先級

```text
1. Existing architecture
2. Existing visual language
3. Fluent tokens
4. Motion system
5. Component states
6. Overlay architecture
7. Page transitions
8. Decorative enhancements
```

永遠不要：

```text
Decorative animation
```

優先於：

```text
Accessibility
Functionality
Layout
Performance
```

---

# 72. Dependency Rule

如果 CSS / Web API 可以解決：

**不要安裝 package。**

如果網站已有：

```text
Motion One
GSAP
Framer Motion
```

也不要立即替換。

先評估：

```text
Existing dependency
+
existing architecture
+
bundle cost
```

---

# 73. Testing

每次 motion system 修改後：

```bash
npm run build
```

如果存在：

```bash
npm run check
npm run lint
npm run test
```

全部執行。

---

# 74. Browser Testing

至少測：

```text
Chromium
Firefox
Safari
```

以及：

```text
Desktop
Tablet
Mobile
```

---

# 75. Accessibility Testing

確認：

```text
prefers-reduced-motion
keyboard
focus-visible
screen reader
contrast
touch target
```

---

# 76. Performance Testing

DevTools：

```text
Performance
Rendering
Layers
Memory
Network
```

注意：

```text
Long Tasks
Layout Shift
Paint
FPS
Memory growth
```

---

# 77. Final Quality Bar

一個 Fluent animation 如果符合：

```text
User understands what happened
+
User understands why it happened
+
Animation is fast
+
Animation is consistent
+
Animation can be disabled
+
No performance regression
```

才可以保留。

---

# 78. Fluent Web Golden Rules

最後只記住這 12 條：

```text
01. Motion must have a purpose.
02. Content comes before decoration.
03. Enter slower than exit.
04. Use easing to communicate physicality.
05. Small movement is usually better.
06. Use hierarchy to choreograph motion.
07. Use elevation to communicate depth.
08. Use material to communicate surface hierarchy.
09. Prefer transform and opacity.
10. Never solve stacking architecture with huge z-index values.
11. Respect reduced motion.
12. If an animation makes the UI slower, remove it.
```

---

# 79. Reference Mapping

本規範主要參考：

- Fluent 2 Design System — Design Principles
- Fluent 2 Design System — Motion
- Fluent 2 Design System — Layout
- Windows Apps — Design Guidelines
- Windows Apps — Motion
- Windows Apps — Timing and Easing
- Windows Apps — Motion in Practice
- Windows Apps — Connected Animation
- Windows Apps — Animation Performance

Fluent 2 官方 motion 指南目前將 motion transition 分為 Enter/Exit、Elevation、Top Level、Container Transform 等常見模式；Windows guidance 同時提供標準 duration 與 easing guidance。

---

# 80. Final Design Philosophy

這套系統的最終目標不是讓 Astro 網站「看起來像一個 Windows App」。

而是：

```text
Astro Web
   +
Web-native architecture
   +
Fluent visual language
   +
Windows-quality motion
   +
Accessible interaction
   +
Responsive behavior
   +
Performance discipline
```

形成一個：

> **Fluent-inspired Web Experience**

它應該讓使用者在第一次看到網站時感受到：

```text
清晰
有層次
有重量
有反應
有連續性
但不喧賓奪主
```

這才是本 Design System 的完成標準。

---

# 81. Design Token Master Reference（Agent 快查表）

> 本節彙整全文出現過的所有 CSS custom properties，作為單一查詢入口。**若正文其他段落的數值與本節不一致，以本節為準**，並視為文件內部尚未同步的錯誤（歡迎回報／修正正文）。Agent 在撰寫任何新元件前，應先查本節是否已有可用 token，而不是新發明數值。

```css
:root {
  /* Radius */
  --fluent-radius-xs: 4px;
  --fluent-radius-sm: 6px;
  --fluent-radius-md: 8px;
  --fluent-radius-lg: 12px;
  --fluent-radius-xl: 16px;
  --fluent-radius-2xl: 20px;

  /* Spacing */
  --fluent-space-1: 4px;
  --fluent-space-2: 8px;
  --fluent-space-3: 12px;
  --fluent-space-4: 16px;
  --fluent-space-5: 20px;
  --fluent-space-6: 24px;
  --fluent-space-8: 32px;
  --fluent-space-10: 40px;
  --fluent-space-12: 48px;
  --fluent-space-16: 64px;

  /* Duration */
  --fluent-duration-instant: 83ms;
  --fluent-duration-fast: 167ms;
  --fluent-duration-normal: 250ms;
  --fluent-duration-emphasis: 333ms;

  /* Easing */
  --fluent-ease-decelerate: cubic-bezier(0, 0, 0, 1);   /* Enter */
  --fluent-ease-standard: cubic-bezier(0.55, 0.55, 0, 1); /* Existing element state change */
  --fluent-ease-accelerate: cubic-bezier(1, 0, 1, 1);   /* Exit */
  --fluent-ease-linear: linear;                          /* Rotation / progress only */

  /* Elevation layers (z-index) */
  --fluent-layer-base: 0;
  --fluent-layer-content: 10;
  --fluent-layer-sticky: 100;
  --fluent-layer-dropdown: 1000;
  --fluent-layer-flyout: 1100;
  --fluent-layer-dialog: 2000;
  --fluent-layer-toast: 3000;

  /* Shadow */
  --fluent-shadow-1: 0 1px 3px rgb(0 0 0 / 0.12);
  --fluent-shadow-2: 0 4px 12px rgb(0 0 0 / 0.14);
  --fluent-shadow-3: 0 8px 24px rgb(0 0 0 / 0.18);
  --fluent-shadow-4: 0 16px 40px rgb(0 0 0 / 0.22);
}
```

### 對照表：什麼場景查哪個 token

| 需求 | 查哪一組 token | 對應章節 |
|---|---|---|
| 元件圓角 | `--fluent-radius-*` | §3 |
| 元件內外距 | `--fluent-space-*` | §4 |
| Hover / press / dropdown 動畫時長 | `--fluent-duration-*` | §11 |
| Enter / 狀態變化 / Exit 的曲線 | `--fluent-ease-*` | §12–§13 |
| Dropdown / Dialog / Toast 疊放順序 | `--fluent-layer-*` | §7–§8 |
| Card / Overlay 立體感 | `--fluent-shadow-*` | §53 |

實際數值必須配合網站既有 light/dark theme（見 §54–§55），不要把本表當成寫死的顏色系統——本表只涵蓋 geometry / timing / elevation，不涵蓋色彩 token。

---

# 82. Pre-Change Checklist（送出修改前必須逐項確認）

Agent 在完成一次 CSS / motion 相關修改、要回報「完成」之前，必須能對以下每一項回答「是」，否則需要回頭修正：

```text
[ ] 所有 radius / spacing / duration / easing / elevation / shadow 數值都來自 §81 token，
    沒有新發明的 magic number（例如 13px、0.37s、z-index: 99999）
[ ] 沒有使用 `transition: all`（§59）
[ ] Hover / press 動畫只動 transform 與 opacity 等 compositor-friendly 屬性，
    沒有同時對 width / height / top / left / margin / padding / font-size 做動畫（§38）
[ ] 已加入 @media (prefers-reduced-motion: reduce) 或等效的 JS matchMedia 檢查，
    且 reduced-motion 下仍保留 state / visibility / focus / hierarchy（§41–§42）
[ ] Focus ring 獨立於 hover 動畫，不會因為 reduced motion 或動畫被中斷而消失（§21）
[ ] Dropdown / Flyout / Dialog / Toast 等 overlay 元件，
    是放進 overlay 層級（如 #overlay-root）解決疊放問題，
    而不是單純調高 z-index 數值（§8、§51）
[ ] Enter 動畫時長 ≥ Exit 動畫時長（§15）
[ ] 若修改的是 §60 Animation Matrix 中列出的元件，行為與該表一致
[ ] 沒有新增動畫函式庫（GSAP / Framer Motion / Motion One 等），
    除非確認 CSS / Web Animation API / View Transition API 無法勝任，
    且評估過現有依賴與 bundle cost（§72）
[ ] npm run build 通過；若專案存在 npm run check / lint / test，也一併執行並通過（§73）
[ ] 已至少概念性確認 Chromium / Firefox / Safari 與 Desktop / Tablet / Mobile 的行為（§74）
[ ] 沒有動到任務範圍以外的檔案；如果有，已在回報中明確說明原因
[ ] 對照 §78 的 12 條 Golden Rules，沒有明顯牴觸
```

---

# 83. Agent 常見失誤模式（Common Agent Failure Patterns）

以下是 AI Agent 在實作本規範時，實務上最容易出現的偏差，附上成因與正確做法，供 Agent 自我檢查（也可作為 code review 時的提示清單）。

| 失誤模式 | 常見成因 | 正確做法 | 對應章節 |
|---|---|---|---|
| 用任意 px / ms 數值（如 `13px`、`370ms`）而不是 token | 生成時傾向給出「看起來合理」的獨立數字 | 一律查 §81，找不到對應 token 才考慮是否要提案新增 | §3 §4 §11 §12 §81 |
| 寫 `transition: all` 圖方便 | 省得列屬性 | 明確列出要動畫的屬性（通常只有 transform / opacity / background-color 等） | §59 |
| 沒有先 audit 專案結構就直接新建或覆寫檔案 | 跳過探索步驟、假設檔案路徑 | 先執行 §70 Step 1（audit package.json / astro.config / src 結構），確認架構後再動手 | §70 |
| Dropdown 被遮住時直接把 z-index 調到 999999 | 治標不治本、最快「看起來」解決 | 檢查是否有 transform / filter / backdrop-filter / opacity / isolation / contain 造成新的 stacking context，必要時搬進 overlay 層 | §8 §51 |
| 一個 hover 同時觸發 scale + rotate + glow + shadow + blur | 想讓效果「更豐富」 | 每次互動只疊加 1–2 種效果，其餘留給 elevation / surface 表達 | §18 |
| 忽略 `prefers-reduced-motion`，或 JS 動畫沒有 `matchMedia` 檢查 | 只在預設瀏覽器設定下測試 | 一律加入檢查；reduced motion 下移除位移動畫但保留狀態與可見性 | §41 §42 |
| 為了做動畫就安裝新的動畫函式庫 | 想要更精細的控制 | 先評估 CSS transition / Web Animation API / View Transition API 是否足夠；已有依賴時先評估而非替換 | §72 |
| 把裝飾性動畫的優先權排在無障礙 / 效能 / 功能之前 | 動畫寫起來有明顯的「完成感」 | Decorative enhancement 永遠是修改優先級中最後一項 | §71 |
| 生成看似合理但其實是編造的 CSS 屬性或瀏覽器 API | 模型幻覺，記憶中的 API 細節不精確 | 以本文件已附的程式碼範例為準，不確定的 API 需要另外查證，不要憑印象生成 | 全文 |
| 大幅修改超出任務範圍的檔案或既有 architecture | 想「順便」整理或統一風格 | §71 明訂 Existing architecture 與 Existing visual language 優先權最高，非必要不動 | §46 §71 |

---

# 84. Machine-Readable Rule Manifest（YAML）

> 提供給需要程式化解析（例如 lint 腳本、CI 檢查、另一個 Agent 的 pre-flight 讀取）使用的精簡版本。內容是 §81–§83 的結構化摘要，人類閱讀請以前述章節為準；本區塊若與前述章節數值不一致，以 §81 的 CSS 區塊為最終真相來源。

```yaml
document:
  name: "Fluent UI Design & Motion Guidelines for Astro"
  version: "1.1"
  edition: "ai-agent"

tokens:
  radius:
    xs: 4px
    sm: 6px
    md: 8px
    lg: 12px
    xl: 16px
    2xl: 20px
  spacing:
    1: 4px
    2: 8px
    3: 12px
    4: 16px
    5: 20px
    6: 24px
    8: 32px
    10: 40px
    12: 48px
    16: 64px
  duration:
    instant: 83ms
    fast: 167ms
    normal: 250ms
    emphasis: 333ms
  easing:
    decelerate: "cubic-bezier(0, 0, 0, 1)"   # enter
    standard: "cubic-bezier(0.55, 0.55, 0, 1)" # existing element state change
    accelerate: "cubic-bezier(1, 0, 1, 1)"   # exit
    linear: "linear"                          # rotation / progress only
  elevation_layers:
    base: 0
    content: 10
    sticky: 100
    dropdown: 1000
    flyout: 1100
    dialog: 2000
    toast: 3000
  shadow:
    1: "0 1px 3px rgb(0 0 0 / 0.12)"
    2: "0 4px 12px rgb(0 0 0 / 0.14)"
    3: "0 8px 24px rgb(0 0 0 / 0.18)"
    4: "0 16px 40px rgb(0 0 0 / 0.22)"

hard_rules:
  - id: R-NO-TRANSITION-ALL
    section: 59
    severity: MUST_NOT
    rule: "Never use `transition: all`; enumerate animated properties explicitly."
  - id: R-COMPOSITOR-FRIENDLY-ONLY
    section: 38
    severity: SHOULD
    rule: "Prefer animating transform and opacity; avoid animating width/height/top/left/margin/padding/font-size."
  - id: R-REDUCED-MOTION
    section: [41, 42]
    severity: MUST
    rule: "Implement prefers-reduced-motion (CSS and/or matchMedia in JS). Motion is removed; state, visibility, focus, and hierarchy remain."
  - id: R-NO-ZINDEX-HACK
    section: [8, 51]
    severity: MUST_NOT
    rule: "Do not fix overlay stacking issues by only raising z-index. Diagnose stacking-context causes (transform, filter, backdrop-filter, opacity<1, isolation, contain) first."
  - id: R-OVERLAY-ROOT
    section: 8
    severity: SHOULD
    rule: "Dropdown, Flyout, Dialog, and Toast should render into a top-level overlay layer (e.g. #overlay-root) when they must cross card/section/clipping boundaries."
  - id: R-ENTER-SLOWER-THAN-EXIT
    section: 15
    severity: SHOULD
    rule: "Enter animation duration should be greater than or equal to exit animation duration."
  - id: R-DEPENDENCY-LAST-RESORT
    section: 72
    severity: SHOULD
    rule: "Do not add an animation library if CSS or native Web APIs can solve the task. Do not replace an existing animation library without evaluating existing dependency, architecture, and bundle cost."
  - id: R-DECORATION-LOWEST-PRIORITY
    section: 71
    severity: MUST
    rule: "Decorative animation is always lower priority than accessibility, functionality, layout, and performance."
  - id: R-TOKENS-OVER-MAGIC-NUMBERS
    section: [3, 4, 11, 12, 53, 81]
    severity: SHOULD
    rule: "Use existing design tokens for radius, spacing, duration, easing, elevation, and shadow instead of inventing new literal values."

agent_workflow:
  read_before_any_change: [0, 61, 70, 71, 72]
  read_for_task: "use table_of_contents to jump to the relevant component section(s)"
  consult_for_values: [81]
  verify_before_submitting: [82]
  self_check_against: [83]
  run_after_change:
    always: ["npm run build"]
    if_present: ["npm run check", "npm run lint", "npm run test"]
  golden_rules_override_everything: [78]
```

---
