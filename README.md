# Obsidian AI Renamer

An Obsidian plugin that automatically renames notes using AI. It reads the note content and generates a descriptive filename in the format `timestamp-short-name` (e.g., `20260312-meeting-notes-q4-review.md`).

## Features

- **Rename current note** — generate an AI-powered name for the active note
- **Rename all notes** — batch rename every note in your vault (with confirmation)
- **Timestamp prefix** — configurable date format (YYYYMMDD, YYYYMMDD-HHmm, YYYY-MM-DD)
- **Smart skipping** — already-renamed files (with date prefix) are skipped during batch rename
- **Folder exclusion** — skip specific folders (e.g., templates, daily notes)
- **API key in settings** — password-masked input, stored locally

## Prerequisites

- An [OpenAI API key](https://platform.openai.com/api-keys)
- Obsidian v0.15.0 or later

## Installation

### Option 1: BRAT (Recommended)

1. Install the **BRAT** plugin from **Settings > Community plugins > Browse**
2. Open **Settings > BRAT** and click **Add Beta Plugin**
3. Enter `harrywang/obsidian-ai-renamer` and click **Add Plugin**
4. Enable **AI Renamer** in **Settings > Community plugins**

### Option 2: Manual Install

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/harrywang/obsidian-ai-renamer/releases)
2. Create `.obsidian/plugins/obsidian-ai-renamer/` in your vault
3. Copy `main.js` and `manifest.json` into that folder
4. Enable **AI Renamer** in **Settings > Community plugins**

## Setup

1. Go to **Settings > AI Renamer**
2. Enter your OpenAI API key
3. Choose your preferred model and date format

## Commands

| Command | Description |
|---------|-------------|
| Rename current note with AI | Renames the active note |
| Rename all notes in vault with AI | Batch renames all notes (skips already-renamed files) |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| OpenAI API key | — | Your API key (stored locally, never shared) |
| Model | gpt-4o-mini | AI model to use |
| Date format | YYYYMMDD | Timestamp prefix style |
| Max content length | 1000 | Characters sent to AI (saves tokens) |
| Exclude folders | — | Comma-separated folders to skip |

## Example

A note containing meeting minutes about Q4 budget review would be renamed to:

```
20260312-q4-budget-review-meeting.md
```

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
