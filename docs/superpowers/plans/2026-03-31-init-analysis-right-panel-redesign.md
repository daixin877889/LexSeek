# Init Analysis Right Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the right panel of the case analysis page into a compact "Dashboard" with card-based entries for analysis modules and materials, improving scability and visual clarity.

**Architecture:** 
- Refactor `CaseInfoCard` for better information density.
- Transition `MaterialList` and `AnalysisResults` from list-based to grid-card layouts.
- Implement an internal "Overlay/Layer" navigation within the right panel for deep-diving into specific analysis modules.

**Tech Stack:** Nuxt 4, Vue 3, Tailwind CSS v4, Lucide Icons, Shadcn Vue.

---

### Task 1: Refactor CaseInfoCard Layout

**Files:**
- Modify: `app/components/initAnalysis/CaseInfoCard.vue`

- [ ] **Step 1: Update template for label-value horizontal layout**
  Change the vertical stack to a more compact grid/flex layout where labels are muted and values are prominent.

- [ ] **Step 2: Add support for extraFields**
  Ensure any dynamically extracted fields from the AI are displayed appropriately.

- [ ] **Step 3: Commit**
```bash
git add app/components/initAnalysis/CaseInfoCard.vue
git commit -m "ui: refactor CaseInfoCard to compact label-value layout"
```

### Task 2: Refactor MaterialList to Card Grid

**Files:**
- Modify: `app/components/initAnalysis/MaterialList.vue`

- [ ] **Step 1: Change list container to `grid-cols-2`**
  Update the layout from a single-column list to a two-column grid.

- [ ] **Step 2: Implement card-style material items**
  Each material should be a card with a prominent icon (colored background based on type) and file metadata.

- [ ] **Step 3: Commit**
```bash
git add app/components/initAnalysis/MaterialList.vue
git commit -m "ui: refactor MaterialList to 2-column card grid"
```

### Task 3: Refactor AnalysisResults to Dashboard Mode

**Files:**
- Modify: `app/components/case/AnalysisResults.vue`

- [ ] **Step 1: Add `viewMode` state and Grid UI**
  Add a state to switch between `dashboard` (grid of cards) and `detail` (full markdown).
  Implement the grid UI where each analysis module is a card with a Lucide icon.

- [ ] **Step 2: Implement Detail Overlay logic**
  When a card is clicked, set the active module and switch to `detail` view.
  Add a "Back" button in the detail view to return to the dashboard.

- [ ] **Step 3: Commit**
```bash
git add app/components/case/AnalysisResults.vue
git commit -m "ui: refactor AnalysisResults to support dashboard card grid and detail overlay"
```

### Task 4: Final Integration and Polishing

**Files:**
- Modify: `app/pages/dashboard/cases/init-analysis/[sessionId].vue`

- [ ] **Step 1: Adjust layout constraints**
  Remove any unnecessary padding/margins that might conflict with the new compact designs.

- [ ] **Step 2: Verify responsive behavior**
  Ensure the 2-column grids collapse gracefully if the panel width is too narrow.

- [ ] **Step 3: Commit**
```bash
git add app/pages/dashboard/cases/init-analysis/[sessionId].vue
git commit -m "ui: finalize integration of redesigned right panel dashboard"
```
