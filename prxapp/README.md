# 🏋️ PRX — Personal Record Indexer

PRX is a lightweight, local-first web application designed for tracking strength training plans, workout sessions, and personal records (PRs). It operates completely offline, stores all data locally on the user's device, and follows a clean Material Design 3 aesthetic.

---

## 🎯 What PRX Does

* **Routine & Plan Management:** Build custom workout splits, organize exercises by day, and manage active training programs.
* **Workout Logging:** Log sets, reps, and weights during workouts with structured stepper controls and quick-adjust inputs.
* **Exercise Records:** Automatically tracks peak weight and rep combinations for every exercise, alongside peak durations for timed isometric holds.
* **Routine Day Swapping:** Temporarily override today's planned split with another routine from your active program when training schedules shift.
* **Isometric Stopwatch:** Built-in timer with custom labeling to log timed holds (e.g., Planks, Dead Hangs) directly to your records.
* **MacroCalc:** Built-in goal calculator to estimate daily calorie targets, protein, carbs, and fat distribution based on body weight, target goals, and timeframe sliders.
* **Streak & Consistency Tracking:** Visual weekly bar and monthly calendar tracking completed sessions and rest days.
* **Data Portability:** Export your entire workout and profile history as a JSON file, or import existing backups anytime.

---

## ⚙️ How It Works

PRX is built as a progressive web application (PWA) with zero external library dependencies or server requirements.

* **Local-First Storage:** All plans, logs, isometric records, and profile settings are stored directly in the browser via **IndexedDB** (`DB_VERSION = 3`).
* **Offline Functionality:** A Service Worker (`sw.js`) caches static application assets so the app loads instantly without a network connection.
* **Material Design 3 (MD3):** Interface tokens, cards, bottom sheets, and typography are styled strictly according to MD3 guidelines, using native CSS custom properties.

---

## 🧭 App Overview & Workflow

* **Streak View:** Tracks weekly consistency and monthly workout attendance.
* **Today View:** Logs current workout split, weight, reps, and set changes.
* **Plans View:** Manages training splits and displays the Exercise Records receipt.
* **Side Drawer:** Accesses Profile, Stopwatch, MacroCalc, and Data Export/Import.

---

## 🚀 Installation & Usage

### 1. Web PWA (Any Device)
1. Open [PRX](https://kesav-gh.github.io/trynabeproductive/prxapp/) in Chrome, Safari, or Edge on mobile or desktop.
2. Select **Add to Home Screen** or **Install App** from your browser options.
3. Launch PRX directly from your home screen or app drawer.

### 2. Local Development
To run PRX locally, serve the files over an HTTP origin (required for IndexedDB and Service Worker support):
python3 -m http.server 8000 or npx serve .

Navigate to `http://localhost:8000` in your web browser.

---

## 📜 License

PRX is open-source software released under the **GNU General Public License v3.0 (GPL-3.0)**
