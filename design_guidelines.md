# Claim Shield Health - Design Guidelines

## Design Approach: Enterprise SaaS System

**Selected References**: Linear (data clarity) + Stripe (trust/precision) + Healthcare enterprise patterns

**Core Principle**: Clinical precision meets modern SaaS - every interaction must feel authoritative, trustworthy, and efficient for healthcare revenue cycle professionals.

---

## Typography System

**Font Stack**: 
- Primary: Inter (via Google Fonts) - all UI, data, metrics
- Monospace: JetBrains Mono - claim IDs, transaction codes, timestamps

**Hierarchy**:
- Page titles: text-3xl font-semibold (32px)
- Section headers: text-xl font-semibold (20px)
- Card titles: text-base font-medium (16px)
- Body text: text-sm (14px)
- Labels/metadata: text-xs font-medium uppercase tracking-wide (12px)
- Data values: text-2xl font-bold for metrics, text-sm font-mono for IDs

---

## Layout System

**Spacing Primitives**: Use Tailwind units of 1, 2, 4, 6, 8, 12, 16
- Component padding: p-6
- Section spacing: space-y-8
- Card gaps: gap-4
- Tight groupings: gap-2

**Container Strategy**:
- Max-width: max-w-7xl mx-auto for main content
- Sidebar: fixed w-64 for navigation
- Two-column detail pages: grid grid-cols-3 (sidebar col-span-1, main col-span-2)

---

## Component Library

### Navigation
**Sidebar** (fixed left):
- Logo + product name at top (p-6)
- Primary nav items with icons (py-3 px-4, rounded-lg)
- Active state: distinct treatment with icon emphasis
- Bottom: user profile + settings

**Top Bar**:
- Breadcrumbs on left
- Search bar center (max-w-md)
- Notifications + user menu right
- Height: h-16 with border-b

### Dashboard Cards
**Metric Cards** (4-column grid on desktop):
- Large number display (text-3xl font-bold)
- Metric label (text-sm uppercase tracking-wide)
- Trend indicator with small chart sparkline
- Icon top-right corner
- Padding: p-6, rounded-xl, border

**Alert Cards**:
- Icon + severity indicator left edge (4px vertical bar)
- Title + description
- Timestamp (text-xs)
- Action button if applicable
- Dismissible X top-right

### Data Tables
**Claims/Leads Tables**:
- Sticky header row with sort indicators
- Row height: h-14
- Alternating row treatment for scannability
- Status pills inline (px-3 py-1 rounded-full text-xs font-medium)
- Hover state reveals actions menu
- Pagination bottom-right (showing X-Y of Z)

**Risk Score Display**:
- Circular progress indicator or horizontal bar
- Score number prominent (text-2xl font-bold)
- Status label (GREEN/YELLOW/RED as text-xs font-medium)
- Explainability icon trigger adjacent

### Claim Timeline
**Event Timeline** (vertical):
- Left border line connecting events (2px)
- Event nodes: circles with status icons (w-10 h-10)
- Event cards extend right with timestamp, description, actor
- Current/active state emphasized
- "Stuck" alerts: warning badge + red pulse animation
- Spacing between events: space-y-6

### Explainability Panel
**Side Drawer** (slides from right):
- Width: w-96
- Header: "Why this decision?" + close X
- Sections with clear separators (border-b, py-4):
  - Inputs Used (list with icons)
  - Risk Factors (weighted bars showing contribution)
  - Applied Rules (rule names + descriptions)
  - Confidence Score (large percentage)
  - Recommended Actions (checklist, checkboxes disabled)

### Call Integration
**Vapi Call Button**:
- Prominent: "Call with AI" with phone icon
- Loading state during call
- Transcript display: speech-bubble style alternating left/right
- Summary box after call: rounded-lg border p-4

### Intelligence/Patterns View
**Denial Clusters**:
- Card grid showing pattern groups
- Each cluster card:
  - Count badge (top-right, text-lg font-bold)
  - Payer + CPT code + root cause
  - Mini chart showing trend
  - "Generate Rule" button
- Filters top: payer dropdown, date range, CPT search

### Rules Management
**Rules List**:
- Table format with enable/disable toggle left
- Rule name + description
- Impact metric: "Prevented X denials" badge
- Edit/Delete icons right
- Create New Rule: modal form with structured inputs

### Demo Scenarios Page
**Scenario Cards** (2-column grid):
- Large icon representing scenario
- Scenario name (text-lg font-semibold)
- Description (2 lines, text-sm)
- "Trigger Scenario" button (full-width within card)
- Active scenario: border treatment + "Active" badge

---

## Forms & Inputs

**Text Inputs**:
- Height: h-11
- Rounded: rounded-lg
- Border with focus ring
- Label: text-sm font-medium mb-2

**Buttons**:
- Primary: h-11 px-6 rounded-lg font-medium
- Secondary: same height, border variant
- Icon buttons: w-11 h-11 rounded-lg (square)
- Destructive: same structure, semantic treatment

**Status Pills**:
- Inline: px-3 py-1 rounded-full text-xs font-semibold
- Block: px-4 py-2 rounded-lg text-sm font-medium (for prominent states)

---

## Specific Page Layouts

### Dashboard (`/dashboard`)
- 4-column metric cards top (gap-6)
- 2-column below: Chart left (claims over time), alerts right
- Bottom: Recent activity table

### Claims Detail (`/claims/[id]`)
- Header: Claim ID + status pill + amount (h-20)
- 3-column grid:
  - Col 1 (w-1/4): Readiness status large, risk score, patient info card
  - Col 2 (w-1/2): Timeline (vertical, scrollable)
  - Col 3 (w-1/4): Related info, payer details, action buttons stacked

### Leads (`/leads`)
- Kanban board view with status columns (Tailwind grid with equal widths)
- Lead cards: compact, name + phone + source + timestamp
- Drag-and-drop visual affordance
- "Call with AI" button within each card

### Intelligence (`/intelligence`)
- Filters bar top (h-16)
- Main: 3-column cluster grid
- Right sidebar: Top patterns summary (w-80)

---

## Animations

**Minimal, Purposeful Only**:
- Page transitions: none
- Hover states: subtle scale or opacity only
- Timeline events: appear with fade-in when scrolling into view
- Red pulse for stuck claims: subtle, 2s interval
- Loading states: spinner or skeleton screens (no elaborate animations)

---

## Images

**Hero Image**: None - this is an enterprise dashboard, not a marketing site
**Icons Only**: Use Heroicons throughout (outline style for nav, solid for status indicators)
**Illustrations**: Optional small spot illustrations for empty states only

---

## Accessibility

- All interactive elements keyboard navigable
- Focus indicators: 2px ring with offset
- ARIA labels on icon-only buttons
- High contrast ratios maintained throughout
- Screen reader text for status indicators