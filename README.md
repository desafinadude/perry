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

### Zone engines

Each zone can play one of three engines (select with **ENGINE** in the zone row):

| Engine | Description |
| --- | --- |
| **SF2** | SoundFont preset from a loaded `.sf2`/`.sf3` (original behaviour) |
| **SYNTH** | Built-in subtractive synth: 2 oscillators + noise, filter with envelope, ADSR amp, LFO vibrato — editable via the **SYNTH** panel |
| **SAMPLE** | Load a WAV/MP3/OGG file, pitched across the keys around a root note, with loop / one-shot modes and ADSR — via the **SMP** panel |

### Per-channel effects

The **FX** button on each zone opens an insert-effects chain for that zone's
channel: **filter** (LP/HP/BP), **chorus**, **delay**, **reverb** and **pan**.
Soundfont zones are tapped per MIDI channel through SpessaSynth's individual
channel outputs, so every zone gets its own chain; synth/sampler zones get one
chain per zone. Zones that share a SoundFont channel share one chain (they are
one audio stream).

All engine, FX and sampler settings are saved inside saved configs. Sample
audio lives in memory for the session — re-pick the file once after a reload.

### Debug hook

In dev builds, `window.__perryAudio` exposes the live audio graph:
`chains()`, `taps()`, `engines()`, `sfVoices()` and `level()` (master peak,
proves signal end-to-end).

## Tech Stack

- **React 18** + TypeScript
- **Vite** dev server
- **SpessaSynth** — SoundFont synthesis in the browser
- **Tone.js** — sheet music playback timing
- **OpenSheetMusicDisplay** — MusicXML rendering

## Credits

- Piano icon by BnB Studio from the [Noun Project](https://thenounproject.com/icon/piano-8409459/) (CC BY 3.0), redrawn as a vector.
