# Design Brief: MIDI App — Blue Note / Swiss International Style Redesign

**Aesthetic direction:** Reid Miles–era Blue Note Records meets Swiss International Typographic Style. Think *Out to Lunch!*, *Page One*, *At the Cafe Bohemia*. Editorial, precise, muscular.

---

## Colour Palette

```
--bg:          #F5F2EC   /* warm off-white, aged paper */
--surface:     #EDEBE3   /* slightly darker off-white for cards/panels */
--ink:         #111111   /* near-black for primary type and borders */
--accent-1:    #1A6BB5   /* Blue Note blue — used for hero labels, key highlights */
--accent-2:    #D93B2B   /* signal red — used sparingly, max one element per view */
--muted:       #888880   /* secondary text, inactive states */
--border:      #C8C5BB   /* subtle rule lines */
```

---

## Typography

- **Display / headers:** `Bebas Neue` or `Barlow Condensed Black` — all caps, very large, tracking 0. Let it bleed and break grids.
- **UI labels / buttons / nav:** `IBM Plex Mono` or `Space Mono` — reinforces the instrument/technical feel
- **Body / annotations:** `IBM Plex Sans` Condensed, light weight
- **No system fonts. No Inter. No Roboto.**

Type scale is aggressive: jump from 11px labels directly to 48–72px section headers with nothing in between. Contrast is the point.

---

## Layout Principles

- **Strong horizontal bands** — divide the UI into clearly delineated registers like the strip of photos at the bottom of the Messengers cover
- **Asymmetric columns** — a narrow left rail (labels, track names, controls) vs a wide right canvas (piano roll, sequencer grid). Not 50/50.
- **Generous white space** — don't fill every pixel. Dead space is compositional, not waste.
- **One full-bleed typographic element** per major view — e.g. a current mode or track name rendered HUGE and cropped at the edge (like "MESSE-" bleeding off the Messengers cover)
- **Grid-breaking accents** — one element (a BPM counter, a record button) sits outside the grid, rotated or offset, as a compositional punctuation mark

---

## Components

### Buttons / Controls

- Rectangular, no border-radius (0px). Hard edges.
- Default: `--surface` background, `--ink` border 1.5px solid, `--ink` label in monospace caps
- Active/armed state: `--accent-2` background, white label
- Selected/on: `--accent-1` background, white label

### Sliders / Knobs

- Sliders: thin `--border` track, `--ink` filled portion, square thumb (not round)
- Knobs: draw as flat circles with a single tick mark; active ring in `--accent-1`

### Piano Roll / Sequencer Grid

- White keys: `#FFFFFF`, black keys: `--ink`
- Grid lines: `--border`, very thin (0.5px)
- Note blocks: solid `--ink` fill; selected notes in `--accent-1`
- Beat markers: bold `--ink` vertical rule every 4 beats; bar numbers in `IBM Plex Mono` 10px above

### Transport Controls (Play / Stop / Record)

- Treat these like the typographic centrepiece — larger than feels comfortable, left-aligned or bottom-anchored, labels in condensed all-caps

### Panel Headers

- All caps, `Barlow Condensed Black`, `--ink`, 10–14px letter-spacing 0.15em
- Separated from content by a 2px `--ink` rule (not a soft divider — a hard line)

---

## Motion

Minimal and purposeful:

- State transitions: 80ms ease-out only. No bouncy springs.
- Active/playing elements: a single `opacity` pulse or a thin progress bar — never distracting
- No decorative animations

---

## Don'ts

- No rounded cards, no drop shadows, no glassmorphism
- No gradients (except a very subtle noise texture on `--bg` if desired)
- No colour for decoration — colour only carries meaning (armed = red, selected = blue)
- No icons unless absolutely necessary; prefer text labels

---

## Reference Mood

The UI should feel like it could be a Reid Miles sleeve if you squinted — typographically confident, architecturally spare, with one moment of controlled visual tension per screen.