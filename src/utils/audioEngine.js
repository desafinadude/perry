import * as Tone from 'tone';

let synth = null;
let metSynth = null;
let rafId = null;
let startRawTime = 0;
let startWallClock = null;
let currentScale = 1;
let onTimeCallback = null;

function initSynth() {
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.8 },
      volume: -8,
    }).toDestination();
  }
}

function initMetSynth() {
  if (!metSynth) {
    metSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.03 },
      volume: -4,
    }).toDestination();
  }
}

const MIDI_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(midi) {
  return `${MIDI_NOTES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function stopRaf() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function startRaf() {
  stopRaf();
  function tick() {
    if (!startWallClock) return;
    const elapsed = Tone.now() - startWallClock;
    const rawTime = startRawTime + elapsed * currentScale;
    onTimeCallback?.(rawTime);
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

// Play N metronome clicks outside of the main transport (for count-in).
// onBeat(n) is called for each beat (1-based), onDone when finished.
export async function playCountIn(bpm, beatsPerMeasure, scale, onBeat, onDone) {
  await Tone.start();
  initMetSynth();

  const beatDurSec = 60 / (bpm * scale);
  const now = Tone.now();

  for (let i = 0; i < beatsPerMeasure; i++) {
    const t = now + i * beatDurSec;
    const note = i === 0 ? 'C6' : 'G5';
    try { metSynth.triggerAttackRelease(note, '64n', t); } catch (_) {}
    setTimeout(() => onBeat(i + 1), i * beatDurSec * 1000);
  }

  // Fire onDone just after the last click so playback starts on the next beat
  setTimeout(() => onDone(), beatsPerMeasure * beatDurSec * 1000);
}

// scale = tempo/100 (>1 = faster, <1 = slower)
// rawStartTime = position in the score (seconds) to start from
// metronomeOpts = { enabled: bool, bpm: number, beatsPerMeasure: number } | null
export async function startPlayback(timeline, scale, rawStartTime, _totalDuration, onTime, metronomeOpts = null, rawLoopEnd = null) {
  await Tone.start();
  initSynth();
  stopPlayback();

  currentScale = scale;
  startRawTime = rawStartTime;
  onTimeCallback = onTime;

  const transport = Tone.getTransport();
  transport.cancel();
  transport.stop();

  // Schedule note events — stop at loop end if provided
  timeline.forEach(evt => {
    if (evt.time < rawStartTime - 0.01) return;
    if (rawLoopEnd !== null && evt.time >= rawLoopEnd) return; // don't schedule past loop end
    const delay = (evt.time - rawStartTime) / scale;
    const dur = Math.max(0.05, evt.duration / scale);
    const noteNames = evt.midiNotes.map(midiToName);
    transport.schedule((audioTime) => {
      try { synth.triggerAttackRelease(noteNames, dur, audioTime); } catch (_) {}
    }, `+${delay}`);
  });

  // Schedule repeating metronome clicks
  if (metronomeOpts?.enabled) {
    initMetSynth();
    const { bpm, beatsPerMeasure } = metronomeOpts;
    const beatDurSec = 60 / (bpm * scale);

    // Align first click to the nearest beat at rawStartTime
    const rawBeatDur = 60 / bpm;
    const beatsElapsed = rawStartTime / rawBeatDur;
    const beatFraction = beatsElapsed % 1;
    const firstDelay = beatFraction > 0.001 ? (1 - beatFraction) * beatDurSec : 0;
    let beatCount = Math.round(beatsElapsed) % beatsPerMeasure;

    transport.scheduleRepeat((audioTime) => {
      const note = (beatCount % beatsPerMeasure === 0) ? 'C6' : 'G5';
      try { metSynth.triggerAttackRelease(note, '64n', audioTime); } catch (_) {}
      beatCount++;
    }, beatDurSec, `+${firstDelay}`);
  }

  startWallClock = Tone.now();
  transport.start();
  startRaf();
}

export function stopPlayback() {
  stopRaf();
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  try { synth?.releaseAll(); } catch (_) {}
  startWallClock = null;
}

export function pausePlayback() {
  stopRaf();
  Tone.getTransport().pause();
}
