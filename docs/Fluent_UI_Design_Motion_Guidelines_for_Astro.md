# Fluent UI Design & Motion Guidelines for Astro

**Version: 1.1 (AI Agent Edition)**  
**Scope: a Windows 11 / WinUI 3 / Fluent-inspired design system for the Astro web**  
**Purpose: design, development, code review, and AI agent implementation reference**

> This document is not a web port of Microsoft WinUI 3, and it does not ask Astro to use XAML, WinAppSDK, or the WinUI runtime.
>
> It is a design specification that translates Fluent / Windows motion, material, depth, geometry, and interaction principles into web-native rules.
>
> It references Fluent 2, the Windows Design Guidelines, and the WinUI motion guidance; the concrete web tokens and CSS implementations are adaptation values for this site, not a one-to-one copy of Microsoft's official tokens.

**Changes in version 1.1**: fixed broken reference markers left in the body; added "How to use this document", a Table of Contents, §81 Token quick reference, §82 Pre-change checklist, §83 Common agent failure patterns, and §84 Machine-readable rule manifest, so that an AI agent can find rules faster, read "must / should / may / must not" with consistent semantics, and have a checkable verification step before and after a change. The content and rules of the original §0–§80 are unchanged.

---

## How to use this document (notes for AI agents)

This document has 81 sections (§0–§80), plus the newly added §81–§84, for 85 sections in total, and it is long. An AI agent **should not stuff the whole text into context on every task**; it should read using the strategy below.

### Normative keywords

This document is written in English, but the strength of each statement is meaningful; read it according to the table below, which is equivalent to RFC 2119 MUST / SHOULD / MAY:

| Term in this document | Equivalent meaning | How an agent should handle it |
|---|---|---|
| must, must not, forbidden | **MUST / MUST NOT** | No exceptions; a violation is a bug and may not be skipped because it "looks prettier" |
| should, recommended, preferred | **SHOULD** | Follow by default; if there is a clear, statable reason to deviate, state that reason in the PR / commit message |
| may, can | **MAY** | Optional depending on context; not following it is not an error |
| don't, avoid | **SHOULD NOT** (treated as MUST NOT if "forbidden" appears in the same paragraph) | Don't do it by default; consider it only when there is a clear design reason |
| unless / unless there is a clear reason | Conditional exception | The exception must be a "clear, statable" reason, not "I think it looks better" |

### Recommended reading order for agents

1. **Always read first**: §0 (Design North Star), §61 (Motion Decision Tree), §70–§72 (AI Agent Implementation Rules / modification priority / Dependency Rule). These define the highest-level judgement of "should it move, how should it move, should a dependency be installed".
2. **Jump by task**: use the Table of Contents below to go straight to the relevant component (for example, read §22–§23 when changing a Dropdown, or §24 when changing a Dialog); there is no need to read the whole document.
3. **Always look values up in §81**: do not re-derive values from the scattered sections such as §3 / §4 / §11 / §12 / §53. §81 is the single source of truth, and if a value elsewhere in the body disagrees with §81, §81 wins.
4. **Before submitting a change**: check every item in the §82 Pre-Change Checklist.
5. **When unsure whether you have hit a common mistake**: compare against §83.
6. **When tokens / rules must be parsed programmatically**: read the YAML manifest in §84; there is no need to re-parse the Markdown prose.

### Conflict resolution order

When a specific component rule (for example the animation in §22 Dropdown) appears to conflict with a general principle (for example §9 Motion Principles):

```text
Specific component rule
   takes precedence over
General principle
   but
Accessibility (§41 §42 §43)
Golden Rules (§78)
   always take precedence over both
```

That is: the more specific rule may override the more general one, but accessibility and the 12 Golden Rules of §78 are a floor that cannot be overridden.

### Table of Contents

<details>
<summary>Expand the full section list (§0–§80)</summary>

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
- [50. Fluent Select Complete Specification](#50-fluent-select-complete-specification)
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
- [71. AI Agent Modification Priority](#71-ai-agent-modification-priority)
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

The goal of the site is not:

> "to add lots of Windows 11 animations."

It is:

> **to make users feel that the UI has hierarchy, weight, and continuity, and that every animation has a purpose.**

The core of Fluent Motion can be summarised as:

```text
Functional
Natural
Consistent
Appealing
```

Fluent officially defines motion as a tool that helps users understand UI state, direction, and relationships, rather than as pure decoration.

Therefore:

```text
Motion ≠ Decoration
Motion = Information + Feedback + Continuity
```

---

# 1. Fluent Design Principles

## 1.1 Natural on every platform

The web is not the Windows desktop.

Therefore:

- Use web-native interaction patterns.
- Keep Astro's rendering architecture.
- Do not imitate WinUI APIs that do not exist in the browser.
- On Windows it may carry the Windows 11 visual language.
- On macOS / Linux / mobile it should still be a normal web UI.

Fluent's own guidance also stresses that an experience should adapt to the platform the user is on.

---

## 1.2 Built for focus

Animation should not steal attention away from the content.

Priority order:

```text
Content
  ↓
Interaction
  ↓
Context
  ↓
Decoration
```

If an animation is beautiful but leaves the user unsure what they just clicked:

**remove the animation.**

---

## 1.3 One for all

Every interaction must account for:

- keyboard
- screen reader
- reduced motion
- touch
- mouse
- small screens
- low-power devices

The Fluent motion guidance explicitly requires a no-motion experience, and warns against abrupt, flashing, or potentially uncomfortable movement.

---

## 1.4 Unmistakably Fluent

The site may have:

- rounded geometry
- translucent surfaces
- subtle depth
- restrained motion
- clear hierarchy
- responsive feedback

But it must not become:

```text
Everything floats
Everything glows
Everything bounces
Everything blurs
Everything animates
```

That is not Fluent.

---

# 2. Visual Language

The Fluent UI visual language is made up of several dimensions that work together:

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

The Windows design guidelines likewise list elevation, geometry, layout, materials, motion, navigation, and typography among the core design areas.

---

# 3. Geometry

## 3.1 Corner Radius

Prefer establishing semantic radii rather than letting every component set its own.

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

Recommended:

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

### Principle

Adjacent elements should use related radii.

Don't:

```text
Button = 4px
Input = 17px
Card = 31px
Dialog = 3px
```

unless there is a clear design reason.

---

# 4. Spacing

Fluent layout uses spacing to establish grouping and hierarchy; the closer things are, the more easily users read them as one group.

Establish base spacing:

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

Don't invent, for each component:

```css
margin-top: 13px;
margin-left: 19px;
padding: 27px;
```

Unless it is a deliberate optical adjustment, prefer the tokens.

---

# 5. Material

The purpose of a Fluent material is not "making the background transparent".

Material should answer:

> Where does this surface sit in the UI hierarchy?

Three web surfaces are recommended:

```text
Solid
Translucent
Elevated / Overlay
```

---

## 5.1 Solid Surface

Ordinary content:

```css
.fluent-surface {
  background: var(--surface);
}
```

---

## 5.2 Translucent Surface

Suitable for:

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

A fallback is mandatory:

```css
@supports not (backdrop-filter: blur(1px)) {
  .fluent-surface-translucent {
    background: var(--surface);
  }
}
```

---

## 5.3 Overlay Surface

Suitable for:

- dropdown
- flyout
- menu
- tooltip
- dialog

An overlay should not use exactly the same material as an ordinary card.

Usually:

```text
Overlay
+ higher opacity
+ stronger border
+ stronger shadow
+ higher elevation
```

---

# 6. Transparency Rules

Transparency is not more Fluent the more of it there is.

Forbidden:

```text
opacity: 0.3
```

letting text sit directly on top of a complex background.

Prefer:

```text
Surface
  +
Contrast
  +
Blur
  +
Border
```

A transparent surface must guarantee:

- text contrast
- focus visibility
- separation from background
- readability

---

# 7. Elevation & Depth

Fluent uses elevation to express hierarchy.

Establish semantic layers:

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

These values are this site's implementation convention.

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

Shadows should strengthen with elevation, rather than everything using the same shadow.

---

# 8. Stacking Context

`z-index` is not the only deciding factor.

The following properties can create a new stacking context:

```text
transform
filter
backdrop-filter
opacity < 1
isolation
contain
```

Therefore:

```css
z-index: 999999;
```

does not guarantee that a dropdown will appear on top.

---

## 8.1 Overlay Architecture

Recommended:

```html
<body>
  <main id="app">
    ...
  </main>

  <div id="overlay-root"></div>
</body>
```

UI that needs to cross card / section / clipping boundaries:

```text
Dropdown
Flyout
Dialog
Toast
```

should preferably go into a top-level overlay layer.

---

# 9. Motion Principles

The official core of Fluent motion:

```text
Functional
Natural
Consistent
Appealing
```

It also stresses duration, easing, transition choreography, and hierarchy.

---

# 10. Motion Vocabulary

This system uses:

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

Each kind of motion has its own purpose.

---

# 11. Duration

The official WinUI guidance uses platform animation durations of 83ms, 167ms, 250ms, and 333ms.

Web adaptation:

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

Not every animation has to use the full duration.

---

# 12. Easing

Recommended:

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

The Windows guidance uses different easing for motion purposes such as Direct Entrance, Existing Elements, and Direct Exit; exit is usually combined with a fade-out.

---

# 13. Easing Selection

## Enter

Use:

```css
var(--fluent-ease-decelerate)
```

because the element needs to "enter and settle".

---

## Existing Element

Use:

```css
var(--fluent-ease-standard)
```

Suitable for:

- resize
- reposition
- state change

---

## Exit

Use:

```css
var(--fluent-ease-accelerate)
```

and usually pair it with:

```text
opacity → 0
```

---

## Linear

Only for:

- rotation
- progress
- continuous mechanical motion

Do not use linear for ordinary UI enter/exit.

---

# 14. Enter Motion

The standard Fluent web enter:

```text
Opacity
+
Small translation
+
Optional small scale
```

Recommended:

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

Don't:

```text
translateY(100px)
scale(0.7)
rotate(10deg)
```

unless it is a special hero animation.

---

# 15. Exit Motion

Exit should be faster than Enter.

For example:

```text
Enter: 250ms
Exit: 167ms
```

This is what makes the UI feel responsive.

---

# 16. Hover Motion

Hover is feedback, not entrance.

Recommended:

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

Press should be brief.

```css
.interactive:active {
  transform: scale(0.98);
}
```

Do not use:

```css
scale(0.90);
```

unless the component itself is very large.

---

# 18. Elevation Motion

Hover may change elevation:

```text
Rest
  ↓
Hover
  ↓
Elevated
```

For example:

```css
.card {
  box-shadow: var(--shadow-1);
}

.card:hover {
  box-shadow: var(--shadow-2);
  transform: translateY(-2px);
}
```

But do not animate all of these at once:

```text
scale
rotate
translate
blur
glow
shadow
```

---

# 19. Fluent Card

The card's standard states:

```text
Rest
Hover
Pressed
Focus
Disabled
```

Recommended:

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

Button:

```text
Rest
Hover
Pressed
Focus
Disabled
```

Recommended:

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

Focus should not be replaced by hover animation.

```css
:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
```

The focus ring should be:

- obvious
- stable
- not blinking
- not dependent on animation

---

# 22. Dropdown / ComboBox

Fluent-style dropdown:

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

The parent appears first:

```text
Surface
 ↓
Items
```

If stagger is needed:

```text
Item 1: 0ms
Item 2: 20ms
Item 3: 40ms
Item 4: 60ms
```

Don't:

```text
0
100
200
300
400
```

Otherwise the menu becomes slow.

The Fluent guidance suggests stagger with a short offset, and warns against letting the overall animation be stretched too long by the stagger.

---

# 24. Dialog

Dialog hierarchy:

```text
Page
 ↓
Backdrop
 ↓
Dialog
 ↓
Dialog Content
```

Backdrop:

```css
.dialog-backdrop {
  opacity: 0;
  transition:
    opacity 167ms var(--fluent-ease-standard);
}
```

Panel:

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

A tooltip should not use a large animation.

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

Expand:

```text
Collapsed
 ↓
Content becomes visible
 ↓
Height / clip changes
```

Prefer grid where possible:

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

Avoid heavy JavaScript height calculation.

---

# 27. Navigation

Top-level navigation is a high-level transition.

The Fluent motion guidance suggests a fast fade for top-level navigation, rather than letting the whole page slide far.

Recommended:

```text
Page A
fade out
↓
Page B
fade in
```

Avoid:

```text
Page A → 100vw slide
Page B ← 100vw slide
```

Unless the user clearly understands that this is spatial navigation.

---

# 28. Connected Motion

When two pages clearly share the same object:

```text
Blog Card
      ↓
Blog Article
```

you may let:

```text
Thumbnail
Title
```

produce a connected transition.

Windows connected animation is used to strengthen the relationship between two views, so the user understands "this page is the thing I just selected".

Web implementation preference:

```text
View Transition API
        ↓
FLIP
        ↓
simple fade
```

---

# 29. Astro View Transitions

If the site uses Astro ClientRouter / View Transitions:

prefer the Astro / browser native transition.

Do not roll your own:

```js
setTimeout(() => {
  location.href = ...
}, 500);
```

because navigation should not be blocked by animation.

---

# 30. Scroll Reveal

The purpose of scroll reveal:

> to help users understand the content hierarchy.

Not:

> to make every element fly in from the sky.

Recommended:

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

Recommended:

```text
Distance: 8–16px
Duration: 167–333ms
```

Don't:

```text
Distance: 200px
Duration: 1s
```

Each section should not have a completely independent animation rhythm.

---

# 32. Choreography

Animation is not an isolated event.

For example:

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

Recommended:

```text
Hero       0ms
Heading   30ms
Body      60ms
Action    90ms
```

But the overall completion time should still stay short.

---

# 33. Hierarchy

Important elements:

```text
Primary action
Main title
Selected item
```

may receive more pronounced motion.

Secondary elements:

```text
Metadata
Secondary text
Decorative elements
```

use less motion.

Fluent officially treats animation hierarchy as an important part of directing attention and reducing navigation confusion.

---

# 34. Animated Icons

Icon motion should be:

```text
Small
Fast
Purposeful
```

For example:

```text
Chevron:
0° → 180°
```

Recommended:

```css
.icon-chevron {
  transition:
    transform 167ms var(--fluent-ease-standard);
}

[data-open="true"] .icon-chevron {
  transform: rotate(180deg);
}
```

Do not let an icon:

```text
rotate 360°
bounce
shake
scale 1.5
```

unless it is itself a feedback animation.

---

# 35. Loading

Loading animation should:

- represent progress / waiting
- not create visual noise
- not use high-frequency flashing

Avoid:

```text
infinite bouncing UI
```

The Microsoft performance guidance also suggests using infinite animations with care, because continuous animation keeps consuming CPU.

---

# 36. Skeleton

Skeleton:

```text
Static shape
+
subtle shimmer
```

Shimmer is not required.

On low power:

```text
No shimmer
```

is preferable to:

```text
Full-page animated shimmer
```

---

# 37. Pointer Highlight

A subtle radial highlight may be used:

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

Use it only on:

```text
Card
Button
Navigation surface
```

Do not track the pointer across the whole site.

---

# 38. Performance

Web implementation must animate these first:

```text
transform
opacity
```

Avoid animating these frequently:

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

Forbidden:

```css
* {
  will-change: transform;
}
```

Only when genuinely needed:

```css
.card.is-animating {
  will-change: transform;
}
```

Remove it after the animation completes.

---

# 40. requestAnimationFrame

Do not use:

```js
requestAnimationFrame(loop);
```

to build a UI animation that runs forever, unless it is a rendering task that genuinely needs it.

If it is just:

```text
hover
scroll reveal
dropdown
dialog
```

prefer CSS.

---

# 41. Reduced Motion

Support is mandatory:

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

But reduced motion should not mean:

```text
UI disappears
```

Remove only the movement.

Still keep:

```text
state
visibility
focus
hierarchy
```

---

# 42. JavaScript Reduced Motion

When a JS animation is needed:

```js
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;
```

If:

```js
reduceMotion === true
```

then:

```text
No stagger
No parallax
No pointer animation
No connected animation
No unnecessary movement
```

---

# 43. Accessibility Motion

Animation should not be the only source of information.

Wrong:

```text
Red animation = error
```

Correct:

```text
Error text
+
ARIA
+
visual state
+
optional motion
```

The Fluent accessibility guidance also points out that important information conveyed by animation should be available another way, for example through ARIA live regions.

---

# 44. Mobile

Mobile:

```text
Less motion
Less blur
Less pointer effects
More direct feedback
```

Do not imitate desktop hover on mobile.

Touch feedback comes first:

```text
Tap
Press
Release
```

---

# 45. Responsive Motion

Animation distance should adapt to the viewport.

Desktop:

```text
translateY(12px)
```

Mobile:

```text
translateY(6px)
```

Large dialog:

Desktop:

```text
scale + translate
```

Mobile:

```text
bottom sheet / small translate
```

---

# 46. Astro Architecture

Recommended:

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

If the actual repository already has an architecture:

**integrate with it first, rather than rebuilding.**

---

# 47. CSS Token Architecture

Recommended:

```text
Primitive
 ↓
Semantic
 ↓
Component
```

For example:

```css
--fluent-blue-500
        ↓
--color-accent
        ↓
--button-background
```

Motion:

```css
--fluent-duration-fast
        ↓
--motion-control
        ↓
--button-transition
```

---

# 48. Component State Model

Every interactive component should preferably establish:

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

Not every component needs every state.

---

# 49. State Transition Rule

State transition should be:

```text
predictable
short
reversible
```

For example:

```text
Closed → Open
Open → Closed
```

using the same visual language.

---

# 50. Fluent Select Complete Specification

Select:

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

Open animation:

```text
opacity
scale
translateY
```

Selected option:

```text
background
check icon
```

Do not let the selected item jump around substantially.

---

# 51. Fancy Select Overlay Rule

Explicit requirement:

```text
.fancy-select-list
```

must live in the overlay hierarchy.

If the situation is:

```text
Fancy Select
    ↓
Card
    ↓
Blog Preview
```

and the dropdown is hidden behind the card:

**you must not simply raise z-index as the only fix.**

You must check:

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

and use this where necessary:

```html
#overlay-root
```

---

# 52. Surface Consistency

The following surfaces should not use completely different transparency:

```text
Card
Blog Preview
Select
Flyout
Dialog
Navigation
```

Establish:

```text
Surface hierarchy
```

For example:

```text
Base surface
Card surface
Elevated surface
Overlay surface
Dialog surface
```

---

# 53. Shadow System

Establish:

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

The actual shadow must work with the site's light/dark theme.

---

# 54. Dark Mode

Dark Fluent UI should not be just:

```text
White → Black
```

It needs to reconsider:

```text
surface
border
shadow
contrast
transparency
```

In dark mode the shadow may need to be more restrained, leaving hierarchy to:

```text
border
contrast
surface separation
```

---

# 55. Light Mode

Light mode:

```text
Shadow
+
Border
+
Surface difference
```

Do not max out all three at once.

Otherwise the UI looks heavy.

---

# 56. Typography

Typography hierarchy:

```text
Display
Title
Subtitle
Body
Caption
Metadata
```

Do not use animation to change font-size.

If hierarchy animation is needed:

```text
opacity
transform
```

---

# 57. Content First

The text itself always takes priority over motion.

Wrong:

```text
Animation
 ↓
content appears after 1 second
```

Correct:

```text
Content immediately available
+
subtle enhancement
```

Animation should not stop users from reading.

---

# 58. Loading Strategy

If server content is already ready:

Don't:

```text
wait for animation
then show content
```

Do:

```text
render content
+
animate presentation
```

---

# 59. No `transition: all`

Forbidden:

```css
transition: all 0.3s ease;
```

Use instead:

```css
transition:
  opacity 167ms var(--fluent-ease-standard),
  transform 167ms var(--fluent-ease-standard);
```

Reason:

to avoid animating unnecessary properties, which lowers unpredictable layout / rendering cost.

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

When an Agent / Developer wants to add animation:

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

Web version:

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

If the site uses Astro client navigation:

initialization should follow:

```js
document.addEventListener(
  "astro:page-load",
  () => {
    initFluentMotion();
  }
);
```

Avoid:

```text
page A listener
+
page B listener
+
page C listener
```

creating duplicate events.

---

# 65. Event Management

Don't:

```js
element.addEventListener(...)
```

register repeatedly on every page navigation.

Use:

```text
idempotent initialization
```

or:

```text
AbortController
```

to manage listener lifecycle.

---

# 66. IntersectionObserver

Scroll reveal:

```text
IntersectionObserver
```

takes priority over:

```text
scroll event + getBoundingClientRect()
```

because reveal is a visibility problem, not a continuous animation problem.

---

# 67. Web Animation API

Suitable for:

```text
Connected animation
Dynamic animation
Runtime-calculated transform
Complex sequence
```

Not suitable for:

```text
Button hover
Card hover
Simple dropdown
Simple tooltip
```

These prefer CSS.

---

# 68. View Transition API

Suitable for:

```text
Page navigation
Connected elements
Large state changes
```

Feature detection is mandatory.

If unsupported:

```text
Normal navigation
```

still works normally.

---

# 69. Progressive Enhancement

Fluent enhancement must follow:

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

Animation must never be a dependency of core functionality.

---

# 70. AI Agent Implementation Rules

Before modifying the site, an AI Agent must:

### Step 1

Audit:

```text
package.json
astro.config.*
src/layouts
src/components
src/pages
src/styles
```

### Step 2

Identify:

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

Do not guess at files.

### Step 4

Establish first:

```text
Tokens
Materials
Elevation
Motion
Accessibility
```

### Step 5

Then modify components.

### Step 6

Build at every stage.

---

# 71. AI Agent Modification Priority

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

Never let:

```text
Decorative animation
```

take precedence over:

```text
Accessibility
Functionality
Layout
Performance
```

---

# 72. Dependency Rule

If CSS / Web APIs can solve it:

**do not install a package.**

If the site already has:

```text
Motion One
GSAP
Framer Motion
```

do not replace them immediately either.

Evaluate first:

```text
Existing dependency
+
existing architecture
+
bundle cost
```

---

# 73. Testing

After every change to the motion system:

```bash
npm run build
```

If these exist:

```bash
npm run check
npm run lint
npm run test
```

run all of them.

---

# 74. Browser Testing

Test at least:

```text
Chromium
Firefox
Safari
```

and:

```text
Desktop
Tablet
Mobile
```

---

# 75. Accessibility Testing

Confirm:

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

DevTools:

```text
Performance
Rendering
Layers
Memory
Network
```

Watch for:

```text
Long Tasks
Layout Shift
Paint
FPS
Memory growth
```

---

# 77. Final Quality Bar

A Fluent animation may be kept only if it satisfies:

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

---

# 78. Fluent Web Golden Rules

In the end, remember just these 12:

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

This specification mainly references:

- Fluent 2 Design System — Design Principles
- Fluent 2 Design System — Motion
- Fluent 2 Design System — Layout
- Windows Apps — Design Guidelines
- Windows Apps — Motion
- Windows Apps — Timing and Easing
- Windows Apps — Motion in Practice
- Windows Apps — Connected Animation
- Windows Apps — Animation Performance

The official Fluent 2 motion guidance currently groups motion transitions into common patterns such as Enter/Exit, Elevation, Top Level, and Container Transform; the Windows guidance also provides standard duration and easing guidance.

---

# 80. Final Design Philosophy

The ultimate goal of this system is not to make an Astro site "look like a Windows App".

It is:

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

to form:

> **Fluent-inspired Web Experience**

On first seeing the site, the user should feel:

```text
Clear
Layered
Weighty
Responsive
Continuous
but never stealing the show
```

That is this Design System's completion criterion.

---

# 81. Design Token Master Reference (Agent quick lookup table)

> This section consolidates every CSS custom property that appears in the document, as a single lookup entry point. **If a value elsewhere in the body disagrees with this section, this section wins**, and that is treated as an error where the document has not yet been synchronised internally (reports / fixes to the body are welcome). Before writing any new component, an Agent should first check whether this section already has a usable token, rather than inventing new values.

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

### Lookup table: which token group to consult for which scenario

| Need | Which token group | Section |
|---|---|---|
| Component corner radius | `--fluent-radius-*` | §3 |
| Component inner / outer spacing | `--fluent-space-*` | §4 |
| Hover / press / dropdown animation duration | `--fluent-duration-*` | §11 |
| Curves for Enter / state change / Exit | `--fluent-ease-*` | §12–§13 |
| Stacking order for Dropdown / Dialog / Toast | `--fluent-layer-*` | §7–§8 |
| Depth for Card / Overlay | `--fluent-shadow-*` | §53 |

The actual values must work with the site's existing light/dark theme (see §54–§55); do not treat this table as a hard-coded colour system — it covers only geometry / timing / elevation, not colour tokens.

---

# 82. Pre-Change Checklist (confirm every item before submitting)

Before reporting "done" after a CSS / motion related change, an Agent must be able to answer "yes" to every item below; otherwise go back and fix it:

```text
[ ] All radius / spacing / duration / easing / elevation / shadow values come from §81 tokens,
    with no newly invented magic numbers (for example 13px, 0.37s, z-index: 99999)
[ ] `transition: all` is not used (§59)
[ ] Hover / press animations only move compositor-friendly properties such as transform and opacity,
    and do not animate width / height / top / left / margin / padding / font-size at the same time (§38)
[ ] @media (prefers-reduced-motion: reduce) or an equivalent JS matchMedia check has been added,
    and state / visibility / focus / hierarchy are still preserved under reduced motion (§41–§42)
[ ] The focus ring is independent of hover animation and does not disappear because of
    reduced motion or because an animation was interrupted (§21)
[ ] Overlay components such as Dropdown / Flyout / Dialog / Toast solve stacking
    by living in the overlay layer (e.g. #overlay-root),
    rather than simply raising the z-index number (§8, §51)
[ ] Enter animation duration >= Exit animation duration (§15)
[ ] If a component listed in the §60 Animation Matrix was changed, behaviour matches that table
[ ] No animation library was added (GSAP / Framer Motion / Motion One, etc.)
    unless CSS / Web Animation API / View Transition API were confirmed insufficient,
    and existing dependencies and bundle cost were evaluated (§72)
[ ] npm run build passes; if the project has npm run check / lint / test, those were run and pass too (§73)
[ ] Behaviour was at least conceptually confirmed on Chromium / Firefox / Safari
    and on Desktop / Tablet / Mobile (§74)
[ ] No files outside the task scope were touched; if any were, the reason is stated
    explicitly in the report
[ ] Compared against the 12 Golden Rules in §78, with no clear conflict
```

---

# 83. Common Agent Failure Patterns

The following are the deviations AI Agents most often produce in practice when implementing this specification, with cause and correct approach, for Agent self-checking (they can also serve as a prompt list during code review).

| Failure pattern | Common cause | Correct approach | Section |
|---|---|---|---|
| Using arbitrary px / ms values (such as `13px`, `370ms`) instead of tokens | Generation tends to produce "plausible-looking" standalone numbers | Always consult §81; only consider proposing a new token if no matching one exists | §3 §4 §11 §12 §81 |
| Writing `transition: all` for convenience | Saves listing properties | Explicitly list the properties to animate (usually only transform / opacity / background-color, etc.) | §59 |
| Creating or overwriting files without auditing the project structure first | Skipping the exploration step, assuming file paths | Run §70 Step 1 first (audit package.json / astro.config / src structure), confirm the architecture, then act | §70 |
| Raising z-index to 999999 when a Dropdown is covered | Treats the symptom, the fastest way to "look" solved | Check whether transform / filter / backdrop-filter / opacity / isolation / contain created a new stacking context, and move it into the overlay layer where necessary | §8 §51 |
| One hover triggering scale + rotate + glow + shadow + blur at once | Wanting the effect to look "richer" | Layer only 1–2 effects per interaction; leave the rest to elevation / surface | §18 |
| Ignoring `prefers-reduced-motion`, or JS animation without a `matchMedia` check | Testing only under default browser settings | Always add the check; under reduced motion remove translation animation but keep state and visibility | §41 §42 |
| Installing a new animation library just to animate | Wanting finer control | First evaluate whether CSS transitions / Web Animation API / View Transition API suffice; with existing dependencies, evaluate rather than replace | §72 |
| Putting decorative animation ahead of accessibility / performance / functionality | Animated code gives an obvious sense of "completion" | Decorative enhancement is always the last item in the modification priority | §71 |
| Generating plausible-looking but fabricated CSS properties or browser APIs | Model hallucination, imprecise memory of API details | Follow the code samples already in this document; verify uncertain APIs separately rather than generating from impression | throughout |
| Broadly modifying files or existing architecture beyond task scope | Wanting to "tidy up" or unify style along the way | §71 states that Existing architecture and Existing visual language have the highest priority; do not touch unless necessary | §46 §71 |

---

# 84. Machine-Readable Rule Manifest (YAML)

> A condensed version for programmatic parsing (for example lint scripts, CI checks, another Agent's pre-flight read). It is a structured summary of §81–§83; for human reading, the sections above take precedence; if this block disagrees with the sections above, the §81 CSS block is the final source of truth.

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
