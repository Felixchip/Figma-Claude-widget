# Figma Claude Widget

A Figma/FigJam widget that lets you chat with Claude right on the canvas.

## Setup

1. `npm install`
2. `npm run build` (or `npm run watch` while developing)
3. In Figma: **Menu → Widgets → Development → Import widget from manifest** and pick `manifest.json`.

## Usage

- Use the widget menu (right-click) to paste your Anthropic API key.
- Type a message and press Enter or click **Send**.
- The conversation is stored with the widget, so it persists across sessions.

## Notes

- The API key is stored in the document as synced state — don't share files that contain real keys.
- Network access is scoped to `https://api.anthropic.com` in `manifest.json`.