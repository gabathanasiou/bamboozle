# Asset Generation Guide

This guide describes how to generate and update assets for **Bamboozle** on Android and iOS using the dedicated `AssetGenerator` tool.

## Key Assets

### 1. App Icon
- **Narrator Expression**: Choose an identity for the app's visual face.
- **Title Visibility**: Usually hidden for the actual app icon, but useful for marketing.
- **Background**: Standardize on the primary brand gradient.

### 2. Loading Screen
- **Grid Stagger**: Every second vertical column is staggered by 50% height.
- **Populations**: Use "Shuffle Population" to get a diverse set of avatars.
- **Size**: Optimized for 1080x1920 phone screens.

### 3. Store Banners
- **Aspect Ratio**: 1920x1080 for standard store backgrounds.
- **Elements**: Features a prominent Narrator on one side and the branding on the other.

## Maintenance

The Asset Generator is designed to be **synchronous with the core codebase**. 

- If you update the `Avatar.tsx` (e.g., adding a new hair type), the Asset Generator will automatically include the new feature in its randomness and expression rendering.
- To change the global branding (e.g., brand colors), update the background gradient options in `tools/AssetGenerator/src/Generator.tsx`.

## Technical Notes

- **Vite Instance**: The generator runs as a secondary Vite process on port 3001.
- **Path Aliasing**: It uses the same `@/` alias as the main app to import components directly.
- **Asset Export**: `html-to-image` is used with `pixelRatio: 2` to ensure high-definition output even on low-res preview monitors.
