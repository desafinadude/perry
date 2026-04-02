# Perry - Desktop App

This branch contains the Tauri-based standalone desktop application version of Perry.

## Known Issues

### MIDI Support on Linux
Unfortunately, the Linux webview (webkit2gtk) does not support the Web MIDI API. There are two options:

**Option 1: Use the web version for MIDI**
Run Perry in Chrome/Chromium which has full Web MIDI support:
```bash
npm run dev
# Open http://localhost:5173 in Chrome
```

**Option 2: Use the desktop app for playback only**
The desktop app works great for:
- Loading and playing back MIDI files
- Using the piano roll
- The metronome and zone editor
- Everything except live MIDI input from controllers

### Workaround for MIDI
If you need MIDI input in the desktop app, you would need to implement a Tauri plugin that bridges native MIDI to the app. This is a more advanced feature that could be added later.

## Icon
The app should use your favicon as the icon. If you see a generic icon:
- On Linux, the icon is embedded in the binary but may take a system restart or cache clear to appear
- When you build a release bundle (`npm run tauri:build`), the icon will be properly included in installers

## Prerequisites

You need to have Rust installed. Install it from [rustup.rs](https://rustup.rs/)

On Linux, you also need some system dependencies:
```bash
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

On Fedora:
```bash
sudo dnf install webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

## Development

Run the app in development mode:

```bash
npm run tauri:dev
```

This will start both the Vite dev server and the Tauri desktop window.

## Building

Create a distributable package:

```bash
npm run tauri:build
```

The built app will be in `src-tauri/target/release/bundle/`

## Features

- Full native desktop app (no browser required)
- Uses system webview (very lightweight compared to Electron)
- Works on macOS, Windows, and Linux
- Native menu bar and window controls
- Can access local filesystem more easily

## Icon

The app uses the favicon files from `public/favicon_io/`. For production, you might want to create higher resolution icons specifically for desktop.
