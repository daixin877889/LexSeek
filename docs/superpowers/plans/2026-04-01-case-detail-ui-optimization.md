# Case Detail UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the navigation, information density, and interactive experience of the case detail page (`/dashboard/cases/[id]`).

**Architecture:**
- **Navigation**: Replace simple title with Breadcrumbs for better context.
- **Analysis View**: Add "Previous/Next" navigation in detail mode; Enable Version History Sheet.
- **Overview**: Standardize section headers and integrate actions; Improve empty states.
- **Materials**: Add "Grid/List" view toggle.

**Tech Stack:** Nuxt 4, Vue 3, Tailwind CSS v4, Shadcn Vue, Lucide Icons.

---

### Task 1: Refactor CaseDetailOverview Section Headers

**Files:**
- Modify: `app/components/caseDetail/CaseDetailOverview.vue`

- [ ] **Step 1: Define a reusable SectionHeader component or local template**
- [ ] **Step 2: Replace absolute-positioned "View All" buttons with integrated header actions**
- [ ] **Step 3: Update Case Info, Materials, and Analysis sections to use the new header style**
- [ ] **Step 4: Add descriptive empty states for Materials and Analysis**

### Task 2: Enhance Analysis Detail Navigation

**Files:**
- Modify: `app/components/case/AnalysisResults.vue`

- [ ] **Step 1: Add "Previous" and "Next" buttons in the Detail view header**
- [ ] **Step 2: Implement logic to switch between modules without returning to the dashboard**
- [ ] **Step 3: Refine the "Back" button to return to Overview if the user came from there (optional/nice-to-have) or ensure it's consistent**
- [ ] **Step 4: Enable `CaseAnalysisVersionSheet` by uncommenting and ensuring props are passed correctly**

### Task 3: Implement Breadcrumbs in Case Detail Page

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`
- Create: `app/components/ui/breadcrumb/index.ts` (if not exists, or check existing breadcrumb component)

- [ ] **Step 1: Check if Shadcn Breadcrumb is available, if not, add it via CLI or manual creation**
- [ ] **Step 2: Replace the `h1` in the header with a Breadcrumb component**
- [ ] **Step 3: Dynamic breadcrumb items: `案件列表 / [案件标题] / [当前视图名]`**

### Task 4: Add View Toggle to CaseDetailMaterials

**Files:**
- Modify: `app/components/caseDetail/CaseDetailMaterials.vue`

- [ ] **Step 1: Add a state for `viewMode` ('grid' | 'list')**
- [ ] **Step 2: Add a ToggleGroup or simple buttons to switch modes in the header**
- [ ] **Step 3: Implement the List view layout (table-like or compact list items)**
- [ ] **Step 4: Ensure responsiveness for both views**

### Task 5: Final Polish and Verification

- [ ] **Step 1: Review mobile responsiveness for all changes**
- [ ] **Step 2: Verify all navigation paths work as expected**
- [ ] **Step 3: Check for any console errors or type issues**
