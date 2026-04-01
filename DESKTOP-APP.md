# Perry - Desktop App

This branch contains the Tauri-based standalone desktop application version of Perry.

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
