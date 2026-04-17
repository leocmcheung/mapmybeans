# Coffee Atlas ☕

A personal journal of coffee beans and their journeys — upload a photo of the bag, let it read the label, then track each bean on a world map.

## Features

- 📸 **Scan labels** with in-browser OCR (Tesseract.js) — no server, no API keys
- 📝 **Editable passport form** pre-filled from the scan
- 🗺️ **World map** with country pins and farm-level pins
- 🔍 **Searchable library** of all your beans
- 💾 **JSON storage** — edits held in localStorage, synced via `beans.json` in your repo

## How to deploy on GitHub Pages

1. Create a new GitHub repo (e.g. `coffee-atlas`).
2. Copy all files in this folder into the repo root and push.
3. In the repo, go to **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch** and select `main` / `(root)`.
5. Wait ~30 seconds — your site will be live at `https://<your-username>.github.io/coffee-atlas/`.

## How storage works

The app uses a simple two-tier approach:

- **Local edits** live in your browser's `localStorage` — instant, no network needed.
- **Cross-device sync** happens through `beans.json` at the root of your repo. On first load, the site fetches this file and shows your existing library.

To sync a new bean across devices:

1. Log the bean on any device.
2. Go to the **Data** tab → **Export beans.json**.
3. Replace `beans.json` in your repo (GitHub web UI works fine: navigate to the file, click the pencil icon, paste the new contents, commit).
4. Other devices (and future-you) will pick up the updated file on next load — or use the **Reload from repo** button.

## File structure

```
coffee-atlas/
├── index.html      # app shell
├── styles.css      # editorial/journal aesthetic
├── app.js          # OCR, form, library, map, data
├── countries.js    # country centroid lookup (no geocoding API)
├── beans.json      # your data — edit this to sync
└── README.md
```

## OCR accuracy — what to expect

Tesseract.js runs entirely in your browser. It works best on:
- High-contrast printed labels
- Photos shot square-on, in good light
- Simple fonts (hand-lettered labels can be tricky)

The parser looks for common coffee-bag conventions (e.g. "Roasted: 10/04/2026", "Process: Natural", "Altitude: 1,950 masl"). Anything it can't identify is left blank for you to fill in — the form is the source of truth.

## Tech

- **Leaflet** + **Carto Voyager** tiles for the map
- **Tesseract.js** for on-device OCR
- **Fraunces** (display) + **DM Mono** (accents) from Google Fonts
- Zero build step, zero dependencies to install — it all runs from static files

## Tips

- The **Look up coordinates** button uses a built-in centroid list for ~40 coffee-producing countries. For farm-specific pins, enter lat/lng manually (many roasters publish these on their websites, or you can grab them from Google Maps).
- Delete a bean from the **Library** tab by clicking the × on its card.
- The **Atlas** tab fits the map to your beans on load — zoom in for detail.

Enjoy your beans. ☕
