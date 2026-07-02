# 井鸽AI影视套件

井鸽AI影视套件 is a local virtual cinematography editor for quickly blocking scenes with whitebox assets and designing camera movement without Blender experience.

## Features

- React, Vite, TypeScript, Three.js and React Three Fiber editor.
- Built-in whitebox assets for characters, buildings, plants and props.
- GLB/GLTF, OBJ, STL, FBX, DAE, PLY, 3MF and 3DS import through the local API.
- Built-in green screen panel with PNG/JPEG/WebP texture upload for background plates.
- Drag-friendly object placement, grid snap, same-height alignment and object color controls.
- Virtual camera keyframes with visible camera positions, targets, curves, anchor locking and cinematic presets.
- Motion-path and fixed-shot timeline modes.
- Lighting controls for multiple lights, intensity, direction, position and color temperature.
- Deterministic Remotion export to MP4 with configurable duration, FPS and resolution.

## Requirements

- Node.js 24+
- npm 11+
- FFmpeg available on PATH for Remotion video rendering

## Run Locally

```bash
npm install
npm run dev
```

The editor runs at `http://127.0.0.1:5173`.
The local API runs at `http://127.0.0.1:5174`.

## Scripts

```bash
npm run dev
npm run build
npm run test
npm run lint
npm run remotion:still
```

## Runtime Folders

These folders are generated locally and are intentionally ignored by git:

- `assets/imports/` for imported model assets
- `assets/textures/` for green screen image plates
- `exports/` for rendered videos and stills
- `tmp/` for render job props, logs and QA screenshots

## Notes

This v1 is a local web application. It does not require Blender and does not connect to a Blender backend.
