# PRX — Personal Record Indexer

## 🎯 What is PRX?
Most fitness applications are bloated with calorie counters, macro trackers, and restrictive diet plans. PRX was built to reject that bloat. It is a lightweight, offline-first application laser-focused on one singular goal: logging Personal Records (PRs). Every tool and interface element inside PRX exists exclusively to improve the experience of tracking and breaking your lifting milestones.

## ⚙️ Architecture & Features
PRX is built to function flawlessly in gym basements with zero cellular reception, while feeling indistinguishable from a native application. 

*   **Tech Stack:** Vanilla JavaScript and Material Design 3 (MD3) for a modern, responsive UI, paired with IndexedDB for robust local data persistence.
*   **PWA Caching:** A custom Service Worker (`sw.js`) leverages a `cache: 'reload'` strategy, enabling full offline functionality while forcing instant code updates without manual cache clearing.
*   **TWA Integration:** Packaged as a Trusted Web Activity (TWA) to bridge the gap between a web application and a native Android environment.
*   **Domain Handshake:** Relies on a secondary root repository to host `.well-known/assetlinks.json` to successfully verify domain ownership and authenticate the TWA.
*   **Zero Bloat:** Stripped of unnecessary social feeds and diet trackers to prioritize raw performance logging.
*   **Streak Engine:** Features custom background logic to calculate and visualize continuous workout streaks.

## 🚀 How to Install
Because PRX is a PWA wrapped in a TWA, there are two ways to deploy it to your device.

### Option 1: Web PWA (Recommended)
This method bypasses Google Play Protect warnings and provides a seamless native installation.
1. Open `https://kesav-gh.github.io/trynabeproductive/prxapp/` in mobile Chrome.
2. Allow the page to fully load, then tap **Add to Home Screen** when prompted.
3. Wait roughly 5 minutes for the background WebAPK service to compile and push the application to your app drawer.

### Option 2: APK Sideloading (via PWABuilder)
1. Navigate to **pwabuilder.com** and enter the PRX web URL: `https://kesav-gh.github.io/trynabeproductive/prxapp/`.
2. Select the Android platform option to package the application.
3. Download the generated `.apk` file and sideload it onto your Android device. The active digital asset link will automatically authenticate the domain root upon launch.

## 🔧 Future Roadmap
*   **JSON Backups:** A local export and import system to safely backup and restore IndexedDB workout logs across devices.
*   
