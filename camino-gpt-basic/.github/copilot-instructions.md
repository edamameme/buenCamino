# Copilot Instructions for camino-gpt-basic

## Project Overview
- **Framework:** Next.js (App Router, React 19+)
- **Frontend Mapping:** Uses both Leaflet (`src/components/Map.tsx`) and MapLibre GL (`src/components/MapLibre.tsx`) for interactive maps.
- **UI/UX:** Main UI is in `src/app/page.tsx`, which lazy-loads the map and provides a chat dock.
- **Styling:** Uses inline styles and global CSS (`src/app/globals.css`).

## Key Patterns & Conventions
- **Client Components:** All interactive components use `"use client"` and React hooks.
- **Dynamic Imports:** Maps are loaded with `dynamic(() => import(...), { ssr: false })` to avoid SSR issues with browser-only libraries.
- **Map Initialization:**
  - Leaflet: Container divs must have explicit height/width. Marker icons are configured via `L.Icon.Default.mergeOptions`.
  - MapLibre: Handles WebGL context loss/restoration. Style URLs must end with `.json`.
- **Status Handling:** Both map components use a `status` state (`init`/`creating`/`ready`/`error`) and display overlays for errors or loading.
- **Chat Dock:** Simple stateful chat in `page.tsx` for user/assistant messages.

## Developer Workflows
- **Start Dev Server:**
  ```sh
  npm run dev
  # or
  pnpm dev
  ```
- **Build:**
  ```sh
  npm run build
  ```
- **Lint:**
  ```sh
  npm run lint
  ```
- **Dependencies:** Uses `pnpm` by default, but `npm`/`yarn`/`bun` also supported.

## Integration & External Services
- **Map Tiles:**
  - Leaflet: OpenStreetMap tiles (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
  - MapLibre: Example styles from OpenFreemap or MapLibre demo
- **No backend API** in this basic version; all logic is client-side.

## File/Directory Guide
- `src/app/page.tsx`: Main entry, chat UI, and map loader
- `src/components/Map.tsx`: Leaflet map implementation
- `src/components/MapLibre.tsx`: MapLibre GL map implementation
- `src/app/globals.css`: Global styles
- `public/`: Static assets (SVGs, icons)

## Project-Specific Tips
- Always ensure map containers have non-zero height/width.
- For MapLibre, use style URLs ending in `.json`.
- Use React state for all UI status and error overlays.
- When adding new maps, follow the dynamic import pattern to avoid SSR issues.

---
For more details, see the README in this directory and in the project root.
