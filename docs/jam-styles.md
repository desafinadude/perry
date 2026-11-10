# Jam styles (pattern files)

The JAM tab's band is driven by **styles** defined in `src/jam/styles.ts`.
A style is plain data — no code — describing how drums, bass and comp play
one bar. Add a style by appending an object to `STYLES`.

```ts
{
  id: 'bossa',                 // stable id (saved with charts)
  name: 'Bossa Nova',          // shown in the STYLE menu
  swing: 0.5,                  // where off-beat 8ths land: 0.5 straight, ~0.62 swing, 0.67 triplet
  defaultBpm: 132,             // used when a chart has no tempo
  matches: ['bossa', 'samba'], // iReal style labels mapped here (substring, case-insensitive)
  drums: { bars: [ [ { t: 0, n: 37, v: 0.6 }, … ], … ], crashOnChorus: false },
  bass:  { bars: [ [ { t: 0, d: 1.4, deg: 'root', v: 0.8 }, … ] ] },   // or { walking: true, v: 0.8 }
  comp:  { voicing: 'shell', bars: [ [ { t: 0, d: 0.45, v: 0.55 }, … ] ], fillChanges: false },
  labels: { drums: 'SIDE STICK · CLAVE', bass: 'ROOT – FIFTH', comp: 'GUITAR-STYLE STABS' },
}
```

## Hits

All times are in **quarter-note beats from the start of the bar** (`t`), lengths
in beats (`d`), velocities 0–1 (`v`). A part with several bars cycles through
them. Hits at or past the bar length are dropped, so 4/4 patterns still work in
3/4 bars. A hit at `x.5` is an off-beat eighth and is moved to `swing`.

- **Drums** — `n` is a General MIDI drum note: 36 kick, 37 side stick,
  38 snare, 42 closed hat, 44 pedal hat, 46 open hat, 49 crash, 51 ride, 53 ride bell.
- **Bass** — `deg` is `root`, `fifth`, `third`, `seventh`, `octave` or
  `approach` (a chromatic lead-in to the next chord's root). Slash chords use the
  slash note as root. `walking: true` improvises a four-to-the-bar walking line.
- **Comp** — each hit plays the chord sounding at `t`; a hit within half a beat
  before a chord change anticipates the new chord. `voicing` is one of
  `rootless` (jazz, 3rd/7th + colours), `shell` (low root + guide tones),
  `triad` (pop) or `spread` (low root + rootless voicing, for ballads).
  `fillChanges: true` also strikes on chord changes the pattern misses.

Voicings are voice-led: each chord picks the inversion closest to the previous one.
