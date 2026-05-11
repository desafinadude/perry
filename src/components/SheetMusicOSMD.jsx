import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// OSMD XML-parsed Pitch.halfTone = MIDI - 12 (one octave below standard MIDI numbering).
function pitchToMidi(pitch) {
  if (!pitch) return null;
  try {
    const ht = pitch.halfTone ?? pitch.HalfTone;
    return (ht != null) ? ht + 12 : null;
  } catch (_) { return null; }
}

// Walk the cursor once and record every step: time, measureIdx, midi numbers, and source notes.
// This is always a linear walk of the score as written — repeats are handled by remapping
// time in syncToTime using the measureOrder from the parser.
function buildTimeline(osmd, bpm) {
  const cursor = osmd.cursor;
  cursor.reset();

  const steps = [];
  let step = 0;
  const wholeNoteSec = 4 * (60 / bpm);

  while (!cursor.Iterator.EndReached) {
    const ts = cursor.Iterator.currentTimeStamp;
    const time = ts.RealValue * wholeNoteSec;
    const measureIdx = cursor.Iterator.CurrentMeasureIndex;

    const midi = [];
    const notes = [];
    try {
      const sourceNotes = cursor.NotesUnderCursor();
      for (const n of sourceNotes) {
        if (n.isRest?.()) continue;
        const m = pitchToMidi(n.Pitch);
        if (m !== null) { midi.push(m); notes.push(n); }
      }
    } catch (_) {}

    steps.push({ step, time, measureIdx, midi, notes });
    cursor.next();
    step++;
  }

  cursor.reset();
  cursor.hide();
  return steps;
}

// Given a playback time that may be in a repeated section (beyond the linear score end),
// remap it back to the equivalent time within the linear score using the parser's measureOrder.
function remapTime(timeSec, tl, measureOrder) {
  if (!measureOrder || measureOrder.length === 0) return timeSec;

  // Build per-measure linear start time and duration from the linear timeline
  const measLinearStart = new Map();
  for (const s of tl) {
    if (!measLinearStart.has(s.measureIdx)) measLinearStart.set(s.measureIdx, s.time);
  }
  const sortedMeasures = [...measLinearStart.keys()].sort((a, b) => a - b);
  const measLinearDur = new Map();
  for (let i = 0; i < sortedMeasures.length; i++) {
    const mi = sortedMeasures[i];
    if (i + 1 < sortedMeasures.length) {
      measLinearDur.set(mi, measLinearStart.get(sortedMeasures[i + 1]) - measLinearStart.get(mi));
    } else {
      // Last measure: estimate from last step
      const lastStep = tl[tl.length - 1];
      const dur = Math.max(0.1, lastStep.time - measLinearStart.get(mi) + 0.25);
      measLinearDur.set(mi, dur);
    }
  }

  // Walk measureOrder accumulating expanded time; find which segment timeSec falls in
  let expandedT = 0;
  for (const mi of measureOrder) {
    const dur = measLinearDur.get(mi) ?? 0;
    if (timeSec < expandedT + dur + 0.001) {
      // timeSec is within this measure occurrence
      const offsetInMeasure = timeSec - expandedT;
      return (measLinearStart.get(mi) ?? 0) + offsetInMeasure;
    }
    expandedT += dur;
  }

  // Beyond all known segments — clamp to last linear time
  return tl[tl.length - 1]?.time ?? timeSec;
}

const SheetMusicOSMD = forwardRef(function SheetMusicOSMD(
  { xmlString, bpm, measureOrder, loopStart, loopEnd, onMeasureClick, onReady, matchMode, isPlaying, onAccuracy },
  ref
) {
  const containerRef = useRef(null);
  const osmdRef = useRef(null);
  const timelineRef = useRef([]);
  const cursorStepRef = useRef(-1);
  const finalNoteJudgedRef = useRef(false);
  const matchModeRef = useRef(false);
  // stepColoredRef: Map<stepIdx, Set<midi>> — midi values already coloured at each step
  const stepColoredRef = useRef(new Map());
  // stepLockedRef: Set<stepIdx> — steps where a wrong note was played (no more input)
  const stepLockedRef = useRef(new Set());
  const correctCountRef = useRef(0);
  const totalJudgedRef = useRef(0);
  const isPlayingRef = useRef(false);
  const measureOrderRef = useRef(measureOrder);
  useEffect(() => { measureOrderRef.current = measureOrder; }, [measureOrder]);
  useEffect(() => { matchModeRef.current = !!matchMode; }, [matchMode]);
  useEffect(() => { isPlayingRef.current = !!isPlaying; }, [isPlaying]);

  const COLORING_OPTS = {
    applyToNoteheads: true, applyToStem: true, applyToBeams: true,
    applyToFlag: true, applyToLedgerLines: true, applyToModifiers: true,
  };

  // Re-show cursor after render() (render() resets cursor visibility)
  const reShowCursor = useCallback(() => {
    if (cursorStepRef.current >= 0) {
      try { osmdRef.current?.cursor.show(); } catch (_) {}
    }
  }, []);

  // Scroll the .sheet-scroll container so the OSMD cursor stays visible.
  // OSMD exposes cursor.cursorElement — an SVG <g> or <img> it injects into the score.
  const scrollToCursor = useCallback(() => {
    try {
      const cursorEl = osmdRef.current?.cursor?.cursorElement;
      if (!cursorEl) return;
      const scrollContainer = containerRef.current?.closest('.sheet-scroll');
      if (!scrollContainer) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const cursorRect = cursorEl.getBoundingClientRect();

      // How far the cursor's top/bottom are relative to the scroll container's viewport
      const topOffset    = cursorRect.top  - containerRect.top;
      const bottomOffset = cursorRect.bottom - containerRect.bottom;

      const margin = 80; // px of breathing room above/below the cursor

      if (topOffset < margin) {
        // Cursor is above (or near the top of) the visible area — scroll up
        scrollContainer.scrollTop += topOffset - margin;
      } else if (bottomOffset > -margin) {
        // Cursor is below (or near the bottom of) the visible area — scroll down
        scrollContainer.scrollTop += bottomOffset + margin;
      }
    } catch (_) {}
  }, []);

  // Move OSMD visual cursor to a timeline step, then scroll it into view
  const moveCursorToStep = useCallback((target) => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    try {
      if (target < cursorStepRef.current || cursorStepRef.current < 0) {
        osmd.cursor.reset();
        cursorStepRef.current = 0;
      }
      while (cursorStepRef.current < target && !osmd.cursor.Iterator.EndReached) {
        osmd.cursor.next();
        cursorStepRef.current++;
      }
      osmd.cursor.show();
      scrollToCursor();
    } catch (_) {}
  }, [scrollToCursor]);

  // ─── Public API ─────────────────────────────────────────────
  useImperativeHandle(ref, () => ({

    // Playback: move cursor with time
    syncToTime(timeSec) {
      const tl = timelineRef.current;
      if (!tl.length) return;

      // If audio is in a repeated section (time beyond linear score), remap back
      // to the equivalent position within the linear score before doing the step lookup.
      const lookupTime = remapTime(timeSec, tl, measureOrderRef.current);

      let target = 0;
      for (let i = 0; i < tl.length; i++) {
        if (tl[i].time <= lookupTime + 0.02) target = i;
        else break;
      }
      if (target === cursorStepRef.current) return;

      // Only mark missed notes if match mode is on AND we're actually playing
      if (matchModeRef.current && isPlayingRef.current && target > cursorStepRef.current && cursorStepRef.current >= 0) {
        const prevStep = cursorStepRef.current;
        setTimeout(() => {
          try {
            const osmd = osmdRef.current;
            if (!osmd) return;
            const colored = stepColoredRef.current.get(prevStep) ?? new Set();
            // move cursor back to prevStep to get gNotes there
            moveCursorToStep(prevStep);
            const gNotes = (osmd.cursor.GNotesUnderCursor() ?? [])
              .filter(gn => !gn.sourceNote?.isRest?.());
            let anyMissed = false;
            for (const gNote of gNotes) {
              const m = pitchToMidi(gNote.sourceNote?.Pitch);
              if (m !== null && !colored.has(m)) {
                gNote.setColor('#ef4444', COLORING_OPTS);
                // count each missed note as a wrong judgment
                totalJudgedRef.current += 1;
                anyMissed = true;
              }
            }
            if (anyMissed) {
              const pct = Math.round((correctCountRef.current / totalJudgedRef.current) * 100);
              onAccuracy?.(pct, correctCountRef.current, totalJudgedRef.current);
            }
            moveCursorToStep(target);
            reShowCursor();
          } catch (_) {}
        }, 250);
      }

      moveCursorToStep(target);
    },

    clearColoring() {
      const osmd = osmdRef.current;
      if (!osmd) return;
      stepColoredRef.current = new Map();
      stepLockedRef.current = new Set();
      correctCountRef.current = 0;
      totalJudgedRef.current = 0;
      try { osmd.render(); } catch (_) {}
    },

    resetCursor() {
      if (!osmdRef.current) return;
      let finalGNotes = [];
      let finalColored = new Set();
      try {
        if (cursorStepRef.current >= 0) {
          finalGNotes = (osmdRef.current.cursor.GNotesUnderCursor() ?? [])
            .filter(gn => !gn.sourceNote?.isRest?.());
          finalColored = stepColoredRef.current.get(cursorStepRef.current) ?? new Set();
        }
      } catch (_) {}

      const lastStep = cursorStepRef.current;
      try {
        osmdRef.current.cursor.reset();
        osmdRef.current.cursor.hide();
        cursorStepRef.current = -1;
        stepColoredRef.current = new Map();
        stepLockedRef.current = new Set();
        finalNoteJudgedRef.current = false;
      } catch (_) {}

      if (lastStep >= 0 && finalGNotes.length > 0) {
        setTimeout(() => {
          try {
            if (!finalNoteJudgedRef.current) {
              for (const gNote of finalGNotes) {
                const m = pitchToMidi(gNote.sourceNote?.Pitch);
                if (m !== null && !finalColored.has(m)) {
                  gNote.setColor('#ef4444', COLORING_OPTS);
                }
              }
            }
          } catch (_) {}
        }, 800);
      }
    },

    getCurrentMeasure() {
      const step = cursorStepRef.current;
      if (step < 0) return 0;
      return timelineRef.current[step]?.measureIdx ?? 0;
    },

    // Jump the visual cursor to the start of a measure index (0-based).
    // This resets the OSMD cursor and advances to the first timeline step
    // that corresponds to the requested measure.
    jumpToMeasure(measureIdx) {
      const osmd = osmdRef.current;
      if (!osmd) return;
      try {
        osmd.cursor.reset();
        // Find the first timeline step that references this measure
        const tl = timelineRef.current || [];
        const targetStep = tl.findIndex(s => s.measureIdx === measureIdx);
        if (targetStep >= 0) {
          // advance the cursor targetStep times
          for (let i = 0; i < targetStep && !osmd.cursor.Iterator.EndReached; i++) {
            osmd.cursor.next();
          }
          cursorStepRef.current = targetStep;
        } else {
          // fallback: advance until OSMD's iterator reaches the measure index
          while (!osmd.cursor.Iterator.EndReached && osmd.cursor.Iterator.CurrentMeasureIndex < measureIdx) {
            osmd.cursor.next();
          }
          cursorStepRef.current = Math.max(0, cursorStepRef.current);
        }
        osmd.cursor.show();
      } catch (_) {}
    },

    // Match mode: judge each note individually.
    // Correct → colour that note green (step stays open for other notes).
    // Wrong → colour all remaining notes red, lock step.
    // A note's colour can never change once set.
    matchNote(midi) {
      const osmd = osmdRef.current;
      if (cursorStepRef.current < 0) { finalNoteJudgedRef.current = true; return; }
      if (!osmd) return;
      if (!isPlayingRef.current) return; // don't judge when not playing

      const step = cursorStepRef.current;

      // Step locked (wrong note already played) — ignore
      if (stepLockedRef.current.has(step)) return;

      const colored = stepColoredRef.current.get(step) ?? new Set();
      // This midi already coloured — ignore
      if (colored.has(midi)) return;

      try {
        const sourceNotes = (osmd.cursor.NotesUnderCursor() ?? []).filter(n => !n.isRest?.());
        const gNotes = (osmd.cursor.GNotesUnderCursor() ?? []).filter(gn => !gn.sourceNote?.isRest?.());
        if (sourceNotes.length === 0) return;

        const sourceMidis = sourceNotes.map(n => pitchToMidi(n.Pitch)).filter(m => m !== null);
        const correct = sourceMidis.includes(midi);

        if (correct) {
          // Colour just the matching note(s) green
          gNotes.forEach(gn => {
            if (pitchToMidi(gn.sourceNote?.Pitch) === midi) gn.setColor('#22c55e', COLORING_OPTS);
          });
          colored.add(midi);
          stepColoredRef.current.set(step, colored);
          correctCountRef.current += 1;
          totalJudgedRef.current += 1;
        } else {
          // Wrong: colour all uncoloured expected notes red, lock step
          gNotes.forEach(gn => {
            const m = pitchToMidi(gn.sourceNote?.Pitch);
            if (m !== null && !colored.has(m)) gn.setColor('#ef4444', COLORING_OPTS);
          });
          stepLockedRef.current.add(step);
          totalJudgedRef.current += 1;
        }

        const pct = Math.round((correctCountRef.current / totalJudgedRef.current) * 100);
        onAccuracy?.(pct, correctCountRef.current, totalJudgedRef.current);

      } catch (e) {
        console.error('[OSMD] matchNote error:', e);
      }
    },

  }), [moveCursorToStep, reShowCursor]);

  // ─── Load & render ───────────────────────────────────────────
  useEffect(() => {
    if (!xmlString || !containerRef.current) return;
    let cancelled = false;

    async function load() {
      containerRef.current.innerHTML = '';

      const osmd = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        drawTitle: true,
        drawSubtitle: true,
        drawComposer: true,
        drawingParameters: 'default',
        pageBackgroundColor: '#ffffff',
      });

      try {
        // OSMD rejects strings that don't start with <?xml. Parse to a DOM Document
        // first so we bypass that check entirely — OSMD accepts Document objects.
        let raw = xmlString.replace(/^﻿/, '').trimStart(); // strip BOM
        if (!raw.startsWith('<?xml')) {
          raw = '<?xml version="1.0" encoding="UTF-8"?>\n' + raw;
        }
        const domParser = new DOMParser();
        const xmlDoc = domParser.parseFromString(raw, 'text/xml');
        const parseErr = xmlDoc.querySelector('parsererror');
        if (parseErr) throw new Error('XML parse error: ' + parseErr.textContent);
        await osmd.load(xmlDoc);
        if (cancelled) return;

        osmd.render();
        osmdRef.current = osmd;
        osmd.cursor.hide();
        cursorStepRef.current = -1;
        stepColoredRef.current = new Map();
        stepLockedRef.current = new Set();
        correctCountRef.current = 0;
        totalJudgedRef.current = 0;

        const tl = buildTimeline(osmd, bpm ?? 120);
        timelineRef.current = tl;
        onReady?.(tl);
      } catch (e) {
        console.error('OSMD render error:', e);
        if (containerRef.current && !cancelled) {
          containerRef.current.innerHTML =
            `<div style="color:#ef4444;padding:20px;font-family:sans-serif">
              <strong>Score render error:</strong> ${e.message}<br/>
              <small>Make sure the file is valid MusicXML (.xml) or compressed MusicXML (.mxl)</small>
            </div>`;
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [xmlString, bpm]);

  return (
    <div className="sheet-scroll">
      <div ref={containerRef} className="sheet-container osmd-container" />
    </div>
  );
});

export default SheetMusicOSMD;
