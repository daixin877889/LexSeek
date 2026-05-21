# Marketing UI Kit

Recreates the **public-facing marketing surface** of LexSeek — landing page at `/`, with the same component pattern reused for `/features`, `/pricing`, `/about`.

Source of truth: `app/layouts/baseLayout.vue` + `app/pages/index.vue` in the LexSeek repo.

## Components

| File | What it is |
|---|---|
| `MarketingNav.jsx` | Sticky top nav — logo lockup, 4 nav links, login/register buttons |
| `Hero.jsx` | Two-column hero — H1 + sub + dual CTA + media well |
| `PainPoints.jsx` | 3-up stat tiles (50% / 75% / 50%) on muted background |
| `FeatureGrid.jsx` | 4-column 8-up feature grid using domain module icons |
| `WorkflowSteps.jsx` | 3 numbered circular steps |
| `CTASection.jsx` | Inverted (primary-bg) bottom CTA with dual buttons |
| `MarketingFooter.jsx` | Copyright + 3 legal links |
| `index.html` | Composes all the above into the live landing page |

## Visual tells

- Sections alternate `bg-background` ↔ `bg-muted/30` (here approximated as `oklch(0.97 0 0 / 0.5)`).
- Single CTA always shows the same wording (`免费体验`); after auth it switches to `开始分析` — exposed as an `onCtaClick` prop on `Hero`.
- All icons in the feature grid are domain SVGs from `assets/module-icons/`. Stat tiles in `PainPoints` use number-as-icon (oversized numerals in primary color) — that's the established pattern in the codebase.
- The CTA section is the **only** screen using `bg-primary` as a backdrop.
