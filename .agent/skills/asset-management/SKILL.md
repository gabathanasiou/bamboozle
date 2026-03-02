---
name: asset-management
description: A guide for generating, managing, and exporting branding assets for Bamboozle.
---

# Asset Management Skill

This skill provides instructions for using the `AssetGenerator` tool to create branding and marketing materials for the Bamboozle application.

## Core Responsibilities

- **Maintain Branding**: Use the Narrator and Avatar components consistently.
- **Generate App Icons**: Create icons for Android/iOS with appropriate expressions and backgrounds.
- **Loading Screens**: Generate the staggered vertical grid assets.
- **Store Graphics**: Design banners and screenshots for Google Play and the App Store.

## Using the Asset Generator

1.  **Launch the tool**:
    ```bash
    npm run asset-generator
    ```
2.  **Access the interface**:
    Navigate to [http://localhost:3001](http://localhost:3001).

## Tool Layout

- **Navigation (Sidebar)**: Switch between Icon, Loading Screen, and Store Banner modes.
- **Preview (Center)**: A high-fidelity rendering of the asset. 
- **Inspector (Right)**: Adjust settings specific to each asset type (Expressions, Grids, Colors).
- **Export**: Downoad high-res PNGs to your local machine.

## Technical Details

- **Components**: The generator imports `Avatar.tsx` and `Narrator.tsx` directly from the main project.
- **Export Engine**: Uses `html-to-image` to capture the DOM as a PNG.
- **Config**: Settings are controlled by a dedicated Vite instance in `tools/AssetGenerator/`.

## Best Practices

- **Android Icons**: Set `borderRadius` to roughly 10-20% for a classic squicle look, or keep it square for adaptive icon generation.
- **Loading Screen Stagger**: Ensure the vertical stagger is clearly visible (it staggers by +0.5 avatar height).
- **Banner Layout**: Rotate or shuffle background avatars if the layout feels too sparse or repetitive.
