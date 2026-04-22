# PDF NiuTrans Auto Translator

An Obsidian desktop plugin that automatically translates selected text in PDF views with the NiuTrans `v2` text translation API.

## Features

- PDF-only selection translation
- Automatically sends a translation request after the selection becomes stable
- No click required
- Simple floating translation panel near the selection
- Chinese and English focused workflow
- Rejects selections longer than 2000 characters
- Uses NiuTrans `appId + timestamp + authStr` signing flow

## How It Works

This plugin only runs in Obsidian's `pdf` view.

When you drag to select text in a PDF:

1. The plugin waits for the selection to stabilize
2. It generates a NiuTrans `authStr`
3. It calls the NiuTrans API automatically
4. It shows the translated text in a floating panel

## Requirements

- Obsidian desktop
- A NiuTrans API application
- Your NiuTrans:
  - `API URL`
  - `API Key`
  - `App ID`

Verified request format:

- Endpoint: `https://api.niutrans.com/v2/text/translate`
- Request body fields:
  - `from`
  - `to`
  - `srcText`
  - `appId`
  - `timestamp`
  - `authStr`

## Installation

### Option 1: Manual install

1. Build the plugin:

```bash
npm install
npm run build
```

2. Copy these files into your vault:

```text
.obsidian/plugins/pdf-niutrans-auto-translator/
  main.js
  manifest.json
  styles.css
```

3. Open Obsidian
4. Go to `Settings -> Community plugins`
5. Disable safe mode if needed
6. Enable `PDF NiuTrans Auto Translator`

### Option 2: Use this repo as source

Clone or download the repository, then copy:

- `main.js`
- `manifest.json`
- `styles.css`

into your vault plugin folder.

## Settings

- `API URL`
  Usually `https://api.niutrans.com/v2/text/translate`
- `API Key`
  Your NiuTrans API key
- `App ID`
  Your NiuTrans application identifier
- `Source language`
  `auto`, `en`, or `zh`
- `Target language`
  `en` or `zh`
- `Auto translate delay`
  Delay before auto-request after selection stabilizes
- `Request timeout`
  Client-side timeout in milliseconds

## NiuTrans Signing Rule

The plugin generates `authStr` like this:

1. Add `apikey` to the request parameters used for signing
2. Sort parameter names in ascending ASCII order
3. Join them as `key=value` pairs with `&`
4. MD5 the resulting string
5. Send the MD5 value as `authStr`

Parameters with empty values are not included in signing.
`authStr` itself is not included in signing.

## Development

Install dependencies:

```bash
npm install
```

Build once:

```bash
npm run build
```

Watch mode:

```bash
npm run dev
```

## Project Structure

```text
src/main.ts         Plugin logic
manifest.json       Obsidian plugin manifest
styles.css          Floating panel styles
esbuild.config.mjs  Build config
```

## Current Limitations

- PDF view only
- No Markdown editor support
- No surrounding-context translation
- No multi-language UI
- Translation panel is intentionally minimal

## Author

H.H

