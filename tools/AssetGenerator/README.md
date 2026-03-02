# Asset Generator

A standalone utility for generating branding assets for **Bamboozle**, including app icons, loading screens, and store banners.

## Overview

The Asset Generator uses the core game components (`Avatar.tsx`, `Narrator.tsx`) to ensure visual consistency across all platforms. It allows you to customize expressions, backgrounds, and layouts before exporting high-definition PNGs.

## Features

- **App Icon**: Generate icons with the Narrator and toggleable title.
- **Loading Screen**: Staggered vertical avatar grid (Pokemon Trozei style).
- **Store Banners**: Wide-format banners for Google Play and App Store.
- **Export**: One-click download of processed PNGs.

## How to Run

1.  Open the project in your terminal.
2.  Install dependencies (if not done already):
    ```bash
    npm install
    ```
3.  Launch the generator:
    ```bash
    npm run asset-generator
    ```
4.  Access the tool at [http://localhost:3001](http://localhost:3001).

## Project Structure

- `tools/AssetGenerator/`: The tool's root directory.
  - `src/Generator.tsx`: Core logic and UI.
  - `main.tsx`: Entry point.
  - `vite.config.ts`: Specialized Vite config.

## Dependencies

- [html-to-image](https://www.npmjs.com/package/html-to-image): For high-quality PNG export.
- [Lucide React](https://lucide.dev/): For premium interface icons.
