# Perry — MIDI Zone Player

Web-based MIDI zone player built with React, SpessaSynth, and Tone.js.

## Quick Start

```sh
./perry              # starts on http://localhost:1234
```

This launches the dev server, opens the browser, and resets USB audio for MIDI detection.

## Manual Start

```sh
yarn dev             # starts on http://localhost:1234
```

## MIDI Device Not Detected?

Run the reset script after the page is loaded:

```sh
./perry-midi-reset
```

This reloads the USB audio kernel module (`snd-usb-audio`), which re-registers MIDI ports with the ALSA sequencer. Chrome picks them up via its ALSA event loop within seconds.

Requires `sudo` for `modprobe`. To make it passwordless:

```
echo 'ALL ALL=(ALL) NOPASSWD: /sbin/modprobe' | sudo tee /etc/sudoers.d/modprobe
```

## How It Works

- Loads SoundFont files (`.sf2`/`.sf3`) via SpessaSynth in the browser
- Splits the keyboard into zones, each with its own SoundFont preset
- Routes live MIDI input through zones for layered/split playing
- Sheet music playback via MusicXML with match mode
- Audio file player for WAV/MP3/OGG

## Tech Stack

- **React 18** + TypeScript
- **Vite** dev server
- **SpessaSynth** — SoundFont synthesis in the browser
- **Tone.js** — sheet music playback timing
- **OpenSheetMusicDisplay** — MusicXML rendering
