# PRX PWA App Master Specification & Implementation Instructions

## Project Overview
PRX is a mobile-native, PWA-based gym workout and Personal Record (PR) tracker hosted on GitHub Pages. The application features a dark-mode tactical aesthetic (`#15161A` background, `#1E2025` card surfaces), haptic feedback, local-first storage using IndexedDB, and clean, high-contrast visualizers inspired by Apple Calendar and Snapseed.

> **Instruction for Claude:** Before writing any code or modifying the repository files, please state your **POV (Point of View)** on the proposed architecture, visual design choices, navigation sequence, font typography hierarchy, and state management logic outlined in this document. Share any additional suggestions or edge-case considerations you identify.

---

## 1. Typography Hierarchy & Font Roles

The application utilizes a strict 3-tier typography system to maintain an editorial yet technical look:

1. **`--font-serif` (Newsreader):** Reserved exclusively for **Main Naming Elements** and prominent headers:
   - App Brand Logo (`PRX`)
   - Personalized User Greeting (`"Welcome back, [Name] 👋"`)
   - Main Section Titles (`MacroCalc`, `WEEKLY STREAK`, `SEPTEMBER 2026`, `YOUR PLANS`)
   - Floating Bottom Navigation Tab Labels (`Streak`, `Today`, `Plans`)
2. **`--font-display` (Space Grotesk):** Used for subheaders, button text, mode selectors, and form labels.
3. **`--font-mono` (IBM Plex Mono):** Reserved for numerical data, weights (kg/lbs), reps, sets, timestamps, and BMI stats.

### Google Fonts Import Requirement:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
```

---

## 2. Global Navigation & Apple-Style Floating Tab Bar

### Tab Sequence & Screen Priority:
1. **Tab 1: STREAK (Default Home / Screen 1):** Consistency visualizer, weekly hero bar, and monthly dot calendar.
2. **Tab 2: TODAY (Active Execution / Screen 2):** Live workout logger and PR tracker.
3. **Tab 3: PLANS (Blueprint / Screen 3):** Workout split CRUD and MacroCalc utility.

### Apple-Style Floating Bottom Navigation Bar:
Rather than a flat edge-to-edge bar, render a detached, floating glassmorphic pill bar pinned to the bottom of the screen.

```ascii
+-------------------------------------------------------------+
|                                                             |
|                    [ MAIN SCREEN CONTENT ]                  |
|                                                             |
|           +-------------------------------------+           |
|           |   • STREAK   |   ◆ TODAY   |   ≡ PLANS  |           |
|           +-------------------------------------+           |
+-------------------------------------------------------------+
```
- **Styling Specs:**
  - `margin: 0 auto 16px auto` with `width: calc(100% - 32px)` (Detached floating appearance).
  - `border-radius: 32px` (Apple-style rounded pill shell).
  - `background: rgba(30, 32, 37, 0.85)` with `backdrop-filter: blur(16px)` (Glassmorphism effect).
  - `border: 1px solid rgba(255, 255, 255, 0.08)`.
  - **Labels:** Rendered in **Newsreader** serif font.
  - **Active Tab Highlight:** High-contrast pill container background (`--surface-raised: #26282E`) that dynamically moves to the currently selected tab.

---

## 3. Screen 1: Streak Page Overhaul & Profile Header

### Header & Greeting:
- **Top Bar:** Brand logo `PRX` (in Newsreader font) on the left; **Profile Icon** button on the right.
- **Profile Modal:** Collects User Name (e.g., `"Kesav"`), Weight (kg), Height (cm), Age, Gender, and Activity Level.
- **Greeting Banner:** Positioned directly above the Weekly Streak card:
  - `"Welcome back, [Name] 👋"` (Rendered in Newsreader font, `font-size: 20px`).

### Component A: Connected Weekly Streak Bar (Top Hero Card)
A clean, horizontal weekly progress node bar for the current week (`S M T W T F S`).

```ascii
+-------------------------------------------------------------+
|  WEEKLY STREAK                                      🔥 4    |
|  Sep 7 – Sep 13                                             |
|                                                             |
|   S         M         T         W         T         F         S |
|  (✓)=======(✓)=======(✓)=======(✓)=======(•)-------( )-------( )|
|                                                             |
+-------------------------------------------------------------+
```
- **Active Days:** Blue filled circular nodes (`#3B82F6`) with checkmarks connected by a solid blue line.
- **Current Day:** Blue ring node with a central white dot (`•`).
- **Rest Days:** Muted grey nodes (`#6B7280`) preserving line continuity for up to 2 rest days/week.
- **Note:** Remove all legend text (`Done`, `Upcoming`) to keep the hero card minimalist.

### Component B: Current-Month Dot Calendar
Render a single-month grid with clear vertical spacing (`margin-top: 24px` below the hero card).
- **Month Header:** `"SEPTEMBER 2026"` in **Newsreader** font with `<` (Past) and `>` (Future) arrows.
- **Past Months (`<`):** Fully functional historical navigation.
- **Future Months (`>`):** View-only calendar grid without active logging options.
- **Dots:** 🔵 Workout Completed | 🟡 PR Broken | 🔴 Missed Day | 🔘 Allowed Rest.

---

## 4. Screen 2: "Today" Tab Layout & Spacing

### Fixes:
1. **Header Collision Fix:** Separate the weekday string (e.g., `saturday`) and the plan title (`No active plan`) with `margin-bottom: 12px` so they do not overlap.
2. **Centered Empty State:** Center the `"Nothing set for today..."` card vertically within the remaining viewport height instead of stacking it high at the top.

---

## 5. Screen 3: Plans Page & MacroCalc Utility

### MacroCalc Accordion Card:
Renamed to **`MacroCalc`** (Title in **Newsreader** font).

```ascii
+-------------------------------------------------------------+
| 📊 MacroCalc                                   [ ∨ DETAILS ]|
|  BMI: 21.1  [===Under===|===Healthy•===|===Obese===]            |
|                                                             |
|  [ 🥩 Aggressive Bulk ]  [ 🏋️ Clean Bulk ]  [ ✂️ Cut ]       |
|                                                             |
|  CALORIES      PROTEIN        CARBS          FATS           |
|  2,830 kcal    104g           426g           79g            |
|                                                             |
|  Target Mode                                                |
|  +-------------------------------------------------------+  |
|  |             CURRENT WEIGHT: 57.5 KG                   |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  Target weight: 62.0kg                                      |
|  [===========================O-------------------------]    |
|                                                             |
|  Timeframe: 8 weeks                                         |
|  [=================O-----------------------------------]    |
+-------------------------------------------------------------+
```

### Key UI Features & Fixes:
1. **Dropdown Chevron Button:** Replace tiny text arrow with a distinct `36px x 36px` tactile button container (`[ ∨ DETAILS ]`) that rotates 180° when expanded.
2. **Preset Button Active Glow Fix:** Ensure clicking a preset (`Aggressive Bulk`, `Clean Bulk`, `Recomp`) immediately strips the active highlight from sibling buttons and applies it strictly to the selected option.
3. **Current Weight Display:** Remove the current weight slider. Display `Current Weight` as a read-only, centered, muted stat badge (data pulled directly from Profile).
4. **Tactile Sliders:** Upgrade range input tracks to **10px height** with a heavy **28px x 28px circular thumb knob** for smooth touch dragging on mobile screens.

---

## 6. CSS Tokens Reference

```css
:root {
  --bg-main: #15161A;
  --surface-card: #1E2025;
  --surface-raised: #26282E;
  --text-primary: #F5F3EC;
  --text-muted: #8B8E94;
  --accent-blue: #3B82F6;  /* Attended / Active */
  --accent-yellow: #EAB308;/* PR Broken */
  --accent-red: #EF4444;   /* Missed Day */
  --accent-grey: #6B7280;  /* Allowed Rest */
  --border-color: #2C2E34;
  --card-radius: 16px;
  
  /* Strict Typography System */
  --font-serif: 'Newsreader', serif;        /* Main Naming & Headlines */
  --font-display: 'Space Grotesk', sans-serif; /* Subheaders, Buttons, Form UI */
  --font-mono: 'IBM Plex Mono', monospace;   /* Numbers, Weights, Sets, Reps */
}
```
