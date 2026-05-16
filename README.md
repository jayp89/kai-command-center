# Kaymina AI (KAI) Command Center

This plugin is meant to work with an Obsidian vault using Gemini CLI if you want to download the it is linked below [Kaymina-Obsidien Vault](https://github.com/jayp89/Kaymina-Obsidien)

# KAI Command Center v2.0 — Install Guide

## What's new in v2.0
- **Overview tab** — ONE Thing, tasks, schedule, metrics, wins, blockers at a glance
- **Focus tab** — Full focus block: ONE Thing, priorities, frogs, tasks, quick wins, reflection
- **Schedule tab** — Full timeline view with colour-coded category tags (Content / Admin / Deep Work / Meeting)
- **Metrics tab** — Today's snapshot + 30-day history table across all metric fields
- **Activity tab** — GitHub-style heatmap (84-day grid), heat intensity from activity log + completed tasks, plus stats (days tracked, active days, tasks completed, frogs eaten)
- **Capture tab** — Quick capture textarea that creates a file in `00 Human/00 Inbox/` and logs to today's Activity Log
- **Live refresh** — Auto-refreshes 800ms after any vault file changes

## How it reads your data
The plugin parses the **body** of your daily notes (not just frontmatter). It reads these sections:
- `## 🎯 Today's Focus` → ONE Thing + priorities
- `## 🐸 Frogs to Eat` → checkbox list
- `## ✅ Today's Tasks` → checkbox list
- `## ⚡ Quick Wins` → checkbox list
- `## 📅 Calendar` → time blocks (`HH:MM-HH:MM Label`)
- `## 📈 Metrics Snapshot` → bullet list of `Label: value` pairs
- `## 📥 Activity Log` → bullet entries
- `## 🧠 End of Day` → wins, blockers, reflection subsections

Daily notes must live at: `00 Human/10 Daily Notes/YYYY-MM-DD.md`

## Installation

### Step 1 — Replace the plugin files
Copy these 3 files into your vault at:
```
.obsidian/plugins/kai-command-center/
  ├── main.ts        (source — for reference)
  ├── main.js        ← YOU NEED TO BUILD THIS (see Step 2)
  ├── styles.css
  └── manifest.json
```

### Step 2 — Build main.js from main.ts
From inside `.obsidian/plugins/kai-command-center/`:
```bash
npm install
npm run build
```
This produces `main.js` which Obsidian actually loads.

> If you don't want to build, you can keep the OLD `main.js` from the repo
> temporarily and swap in the new one after building.

### Step 3 — Reload Obsidian
Settings → Community Plugins → disable and re-enable "KAI Command Center"
Or: Ctrl+P → "Reload app without saving"

### Step 4 — Open the dashboard
Click the grid/dashboard icon in the left ribbon, or:
Ctrl+P → "Open KAI Command Center"

## Tips
- The heatmap colours use your theme's `--interactive-accent` colour automatically
- The Capture tab creates inbox files compatible with the `/new` workflow
- Metrics history table is sortable by scrolling — most recent day is always first
- Run `/today` and `/closeday` via Gemini CLI as normal — the dashboard reads the results live
