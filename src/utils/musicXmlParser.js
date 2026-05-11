// Parse MusicXML for audio playback timeline + metadata.
// Returns the same shape as midiParser so the audio engine is file-format-agnostic.

const NOTE_STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function stepToMidi(step, octave, alter = 0) {
  return (octave + 1) * 12 + NOTE_STEPS[step] + Math.round(alter);
}

function getText(el, tag) {
  return el.querySelector(tag)?.textContent?.trim() ?? null;
}

export function parseMusicXml(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

  // --- Gather tempo / time-signature ---
  let bpm = 120;
  const soundEl = doc.querySelector('sound[tempo]');
  if (soundEl) bpm = parseFloat(soundEl.getAttribute('tempo'));
  // Also check metronome
  const metro = doc.querySelector('per-minute');
  if (metro) bpm = parseFloat(metro.textContent);

  const timeSig = [4, 4];
  const beatsEl = doc.querySelector('time > beats');
  const beatTypeEl = doc.querySelector('time > beat-type');
  if (beatsEl && beatTypeEl) {
    timeSig[0] = parseInt(beatsEl.textContent);
    timeSig[1] = parseInt(beatTypeEl.textContent);
  }
  const beatsPerMeasure = timeSig[0];

  // --- Parse all parts ---
  const parts = Array.from(doc.querySelectorAll('part'));
  const allNoteEvents = []; // { time, duration, midi, partIdx, voiceIdx }
  let noteIdx = 0;

  // measureOrder will be captured from the first part for use by the visual layer
  let sharedMeasureOrder = null;

  parts.forEach((part, partIdx) => {
    const measures = Array.from(part.querySelectorAll('measure'));
    let divisions = 1;
    let absoluteTick = 0; // in divisions (quarter-note ticks)
    let currentBpm = bpm;

    // Preprocess repeats: expand measures order according to simple forward/backward repeat markers.
    const orderedMeasureIndices = [];
    const forwardStack = [];
    for (let i = 0; i < measures.length; i++) {
      const m = measures[i];
      orderedMeasureIndices.push(i);
      const hasForward = !!m.querySelector('barline repeat[direction="forward"]');
      const hasBackward = !!m.querySelector('barline repeat[direction="backward"]');
      if (hasForward) forwardStack.push(i);
      if (hasBackward) {
        const start = forwardStack.length ? forwardStack.pop() : 0;
        for (let j = start; j <= i; j++) orderedMeasureIndices.push(j);
      }
    }

    // Capture the expanded measure order from part 0 (all parts share the same structure)
    if (partIdx === 0) sharedMeasureOrder = orderedMeasureIndices;

    // Process measures in expanded order
    for (const mi of orderedMeasureIndices) {
      const measure = measures[mi];

      // Update divisions if present in this measure
      const divEl = measure.querySelector('attributes > divisions');
      if (divEl) divisions = parseInt(divEl.textContent);

      // Check for time signature changes in this measure
      let measureBeats = beatsPerMeasure;
      const beatsEl = measure.querySelector('attributes > time > beats');
      if (beatsEl) measureBeats = parseInt(beatsEl.textContent);

      // Update tempo if present
      const soundEls = measure.querySelectorAll('direction > sound[tempo]');
      soundEls.forEach(s => { currentBpm = parseFloat(s.getAttribute('tempo')); });

      // Collect note events in this measure.
      let measureTick = absoluteTick;
      let chordStartTick = absoluteTick; // start tick of the current chord group

      const children = Array.from(measure.children);
      for (const child of children) {
        if (child.tagName === 'note') {
          const isChord = !!child.querySelector('chord');
          const isRest = !!child.querySelector('rest');
          const durEl = child.querySelector('duration');
          const dur = durEl ? parseInt(durEl.textContent) : 0;

          // Chord notes use the start tick of the previous (non-chord) note
          const startTick = isChord ? chordStartTick : measureTick;

          if (!isRest) {
            const step = getText(child, 'step');
            const octaveText = getText(child, 'octave');
            const octave = octaveText ? parseInt(octaveText) : 0;
            const alter = parseFloat(getText(child, 'alter') ?? '0');
            if (step) {
              const midiNote = stepToMidi(step, octave, alter);
              const startSeconds = (startTick / divisions) * (60 / currentBpm);
              const durSeconds = Math.max(0.05, (dur / divisions) * (60 / currentBpm));
              allNoteEvents.push({
                id: `xnote-${noteIdx++}`,
                midi: midiNote,
                time: startSeconds,
                duration: durSeconds,
                part: partIdx,
              });
            }
          }

          // Only advance cursor for non-chord notes; chord notes share startTick
          if (!isChord) {
            chordStartTick = startTick; // ensure chord notes reference the non-chord start
            measureTick += dur;
          }
        } else if (child.tagName === 'backup') {
          const dur = parseInt(child.querySelector('duration')?.textContent ?? '0');
          measureTick -= dur;
          if (measureTick < absoluteTick) measureTick = absoluteTick;
        } else if (child.tagName === 'forward') {
          const dur = parseInt(child.querySelector('duration')?.textContent ?? '0');
          measureTick += dur;
        }
      }

      // Advance absolute tick by the measured length of this measure. If parsing found
      // no note durations (measureTick == absoluteTick), fall back to the nominal
      // beats*divisions value to avoid zero-length measures.
      const measureLengthTicks = Math.max(1, measureTick - absoluteTick);
      if (measureLengthTicks <= 1) {
        absoluteTick += (measureBeats || beatsPerMeasure) * divisions;
      } else {
        absoluteTick += measureLengthTicks;
      }
    }
  });

  if (allNoteEvents.length === 0) return null;

  // Deduplicate by time+midi (chord notes appear once per part, but different parts may double)
  const byTime = {};
  for (const n of allNoteEvents) {
    const key = `${n.time.toFixed(4)}_${n.midi}`;
    if (!byTime[key]) byTime[key] = { time: n.time, duration: n.duration, midiNotes: [], noteIds: [] };
    byTime[key].midiNotes.push(n.midi);
    byTime[key].noteIds.push(n.id);
  }
  const timeline = Object.values(byTime).sort((a, b) => a.time - b.time);
  const totalDuration = Math.max(...allNoteEvents.map(n => n.time + n.duration));

  return { bpm, timeSig, beatsPerMeasure, timeline, totalDuration, allNoteEvents, measureOrder: sharedMeasureOrder ?? [] };
}
