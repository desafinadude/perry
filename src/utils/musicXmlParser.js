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

  parts.forEach((part, partIdx) => {
    const measures = Array.from(part.querySelectorAll('measure'));
    let divisions = 1;
    let absoluteTick = 0; // in divisions (quarter-note ticks)
    let currentBpm = bpm;

    measures.forEach(measure => {
      // Update divisions if present
      const divEl = measure.querySelector('attributes > divisions');
      if (divEl) divisions = parseInt(divEl.textContent);

      // Update tempo if present
      const soundEls = measure.querySelectorAll('direction > sound[tempo]');
      soundEls.forEach(s => { currentBpm = parseFloat(s.getAttribute('tempo')); });

      // Collect note events in this measure.
      // MusicXML cursor rules:
      //   normal note  → start at measureTick, then advance by dur
      //   <chord/> note → start at chordStartTick (same as previous note), no advance
      //   <backup>      → rewind measureTick by dur (for multi-voice writing)
      //   <forward>     → advance measureTick by dur
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
            const octave = parseInt(getText(child, 'octave'));
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
            chordStartTick = measureTick; // save before advancing (so next chord note can reference it)
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

      // Advance absolute tick by measure length
      // Use timeSig: beatsPerMeasure quarter-beats = beatsPerMeasure * divisions ticks
      absoluteTick += beatsPerMeasure * divisions;
    });
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

  return { bpm, timeSig, beatsPerMeasure, timeline, totalDuration, allNoteEvents };
}
