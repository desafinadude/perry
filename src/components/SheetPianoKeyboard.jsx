import React, { useMemo, memo } from 'react';

// 88-key piano: MIDI 21 (A0) to MIDI 108 (C8)
const START_MIDI = 21;
const END_MIDI = 108;

const BLACK_POSITIONS = [1, 3, 6, 8, 10]; // within octave

function isBlack(midi) {
  return BLACK_POSITIONS.includes(midi % 12);
}

function buildKeys() {
  const keys = [];
  let whiteIdx = 0;
  for (let m = START_MIDI; m <= END_MIDI; m++) {
    if (!isBlack(m)) {
      keys.push({ midi: m, type: 'white', whiteIdx });
      whiteIdx++;
    }
  }
  for (let m = START_MIDI; m <= END_MIDI; m++) {
    if (isBlack(m)) {
      let leftWhite = m - 1;
      while (isBlack(leftWhite)) leftWhite--;
      const leftWhiteIdx = keys.find(k => k.midi === leftWhite)?.whiteIdx ?? 0;
      keys.push({ midi: m, type: 'black', leftWhiteIdx });
    }
  }
  return keys;
}

const ALL_KEYS = buildKeys();
const WHITE_KEYS = ALL_KEYS.filter(k => k.type === 'white');
const BLACK_KEYS = ALL_KEYS.filter(k => k.type === 'black');
const TOTAL_WHITE = WHITE_KEYS.length;

// Design tokens matching perry style
const INK    = '#111111';
const BORDER = '#C8C5BB';
const SURFACE = '#EDEBE3';
const ACCENT1 = '#1A6BB5';
const ACCENT2 = '#D93B2B';
const MUTED  = '#888880';

export function SheetPianoKeyboard({ activeNotes = new Set(), matchNotes = new Set(), wrongNotes = new Set(), onNotePlay }) {
  const whiteW = 18;
  const whiteH = 64;
  const blackW = 11;
  const blackH = 40;
  const indicatorH = 5; // coloured bottom bar on white keys
  const totalWidth = TOTAL_WHITE * whiteW;

  return (
    <div style={{
      background: SURFACE,
      borderBottom: `2px solid ${INK}`,
      width: '100%',
      lineHeight: 0,
    }}>
      <svg
        viewBox={`0 0 ${totalWidth} ${whiteH}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* White keys */}
        {WHITE_KEYS.map(key => {
          const x = key.whiteIdx * whiteW;
          const isActive = activeNotes.has(key.midi);
          const isMatch  = matchNotes.has(key.midi);
          const isWrong  = wrongNotes.has(key.midi);
          const isC = key.midi % 12 === 0;
          const octave = Math.floor(key.midi / 12) - 1;

          let fill = '#ffffff';
          let indicatorFill = 'none';
          if (isWrong)        { fill = '#f8d0cc'; indicatorFill = ACCENT2; }
          else if (isMatch)   { fill = '#cde0f5'; indicatorFill = ACCENT1; }
          else if (isActive)  { fill = '#DDDBD3'; indicatorFill = INK; }

          return (
            <g key={key.midi} onClick={() => onNotePlay?.(key.midi)} style={{ cursor: 'pointer' }}>
              {/* Key body */}
              <rect
                x={x + 0.5} y={0.5}
                width={whiteW - 1} height={whiteH - 1}
                fill={fill}
                stroke={BORDER}
                strokeWidth={0.5}
              />
              {/* Bottom indicator bar */}
              {indicatorFill !== 'none' && (
                <rect
                  x={x + 0.5} y={whiteH - indicatorH}
                  width={whiteW - 1} height={indicatorH}
                  fill={indicatorFill}
                />
              )}
              {/* C note label */}
              {isC && (
                <text
                  x={x + whiteW / 2}
                  y={whiteH - indicatorH - 4}
                  fontSize={7}
                  textAnchor="middle"
                  fill={isActive || isMatch || isWrong ? INK : MUTED}
                  fontFamily="'IBM Plex Mono', monospace"
                  letterSpacing="0"
                >
                  {`C${octave}`}
                </text>
              )}
            </g>
          );
        })}

        {/* Black keys (rendered on top) */}
        {BLACK_KEYS.map(key => {
          const x = key.leftWhiteIdx * whiteW + whiteW - blackW / 2;
          const isActive = activeNotes.has(key.midi);
          const isMatch  = matchNotes.has(key.midi);
          const isWrong  = wrongNotes.has(key.midi);

          let fill = INK;
          if (isWrong)       fill = ACCENT2;
          else if (isMatch)  fill = ACCENT1;
          else if (isActive) fill = '#444444';

          return (
            <rect
              key={key.midi}
              x={x} y={0}
              width={blackW} height={blackH}
              fill={fill}
              style={{ cursor: 'pointer' }}
              onClick={() => onNotePlay?.(key.midi)}
            />
          );
        })}
      </svg>
    </div>
  );
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export default memo(SheetPianoKeyboard, (prev, next) =>
  setsEqual(prev.activeNotes, next.activeNotes) &&
  setsEqual(prev.matchNotes, next.matchNotes) &&
  setsEqual(prev.wrongNotes, next.wrongNotes) &&
  prev.onNotePlay === next.onNotePlay
);
