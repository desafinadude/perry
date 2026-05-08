import React from 'react';
import {
  Square, Play, Pause, Repeat2,
  Music2, ListMusic,
  Piano, ChevronUp, ChevronDown,
  Crosshair,
} from 'lucide-react';

export default function TransportControls({
  isPlaying, isCounting, countInBeat, beatsPerMeasure,
  onPlay, onPause, onStop,
  tempo, onTempoChange,
  loop, onLoopToggle,
  loopStart, loopEnd, onLoopRangeChange, totalMeasures,
  soloMode, onSoloChange,
  matchMode, onMatchToggle,
  metronome, onMetronomeToggle,
  countIn, onCountInToggle,
  currentTime, totalDuration, onSeek,
  bpm,
}) {
  const pct = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;
  const displayBpm = Math.round((bpm || 120) * (tempo / 100));
  const loopStartPct = (loopStart !== null && totalMeasures > 0) ? (loopStart / totalMeasures) * 100 : null;
  const loopEndPct   = (loopEnd   !== null && totalMeasures > 0) ? ((loopEnd + 1) / totalMeasures) * 100 : null;

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function handleLoopStart(val) {
    const n = parseInt(val);
    if (isNaN(n)) return;
    const s = Math.max(1, Math.min(n, totalMeasures)) - 1; // convert to 0-based
    const e = loopEnd !== null ? Math.max(loopEnd, s) : s;
    onLoopRangeChange(s, e);
  }

  function handleLoopEnd(val) {
    const n = parseInt(val);
    if (isNaN(n)) return;
    const start = loopStart ?? 0;
    const e = Math.max(start, Math.min(n, totalMeasures) - 1); // convert to 0-based, clamp >= start
    onLoopRangeChange(loopStart, e);
  }

  return (
    <div className="transport">
      {/* Progress bar with loop region overlay */}
      <div className="progress-row">
        <span className="time-label">{fmtTime(currentTime)}</span>
        <div className="progress-track-wrap">
          {loop && loopStartPct !== null && loopEndPct !== null && (
            <div
              className="loop-region-bar"
              style={{ left: `${loopStartPct}%`, width: `${loopEndPct - loopStartPct}%` }}
            />
          )}
          <input
            className="progress-bar"
            type="range" min={0} max={100} step={0.1}
            value={pct}
            onChange={e => onSeek(parseFloat(e.target.value) / 100 * totalDuration)}
          />
        </div>
        <span className="time-label">{fmtTime(totalDuration)}</span>
      </div>

      {/* Main controls */}
      <div className="controls-row">
        <div className="btn-group">
          <button className="ctrl-btn" onClick={onStop} title="Stop"><Square size={15} strokeWidth={2} /></button>
          <button
            className="ctrl-btn primary"
            onClick={isPlaying ? onPause : onPlay}
            disabled={isCounting && !isPlaying}
          >
            {isCounting ? (
              <span className="count-in-beat">{countInBeat}</span>
            ) : isPlaying ? <Pause size={15} strokeWidth={2} /> : <Play size={15} strokeWidth={2} />}
          </button>
          <button className={`ctrl-btn ${loop ? 'active' : ''}`} onClick={onLoopToggle} title="Loop"><Repeat2 size={15} strokeWidth={2} /></button>
        </div>

        <div className="btn-group">
          <button
            className={`ctrl-btn ${metronome ? 'active' : ''}`}
            onClick={onMetronomeToggle}
            title="Metronome"
          ><Music2 size={14} strokeWidth={2} /></button>
          <button
            className={`ctrl-btn ${countIn ? 'active' : ''}`}
            onClick={onCountInToggle}
            title="Count-in (one bar before playback)"
          >
            {Array.from({ length: beatsPerMeasure ?? 4 }, (_, i) => (
              <span
                key={i}
                className={`count-dot ${isCounting && countInBeat === i + 1 ? 'active' : ''}`}
              />
            ))}
          </button>
        </div>

        <div className="tempo-group">
          <label>Tempo</label>
          <input type="range" min={25} max={200} step={5} value={tempo}
            onChange={e => onTempoChange(parseInt(e.target.value))} />
          <span className="bpm-display">{displayBpm} BPM</span>
          <button className="reset-btn" onClick={() => onTempoChange(100)}>Reset</button>
        </div>

        {/* Loop range — visible whenever loop is on */}
        {loop && (
          <div className="loop-range-group">
            <span className="loop-range-label">Loop bars</span>
            <input
              className="bar-input"
              type="number" min={1} max={totalMeasures}
              value={loopStart !== null ? loopStart + 1 : 1}
              onChange={e => handleLoopStart(e.target.value)}
            />
            <span>–</span>
            <input
              className="bar-input"
              type="number" min={1} max={totalMeasures}
              value={loopEnd !== null ? loopEnd + 1 : (totalMeasures || 1)}
              onChange={e => handleLoopEnd(e.target.value)}
            />
            {(loopStart !== null || loopEnd !== null) && (
              <button className="reset-btn" onClick={() => onLoopRangeChange(null, null)}>✕</button>
            )}
          </div>
        )}

        <div className="solo-group">
          <label>Solo</label>
          <div className="solo-btns">
            {['both', 'right', 'left'].map(mode => (
              <button key={mode}
                className={`solo-btn ${soloMode === mode ? 'active' : ''}`}
                onClick={() => onSoloChange(mode)}>
                {mode === 'both' ? 'Both' : mode === 'right' ? 'R.H.' : 'L.H.'}
              </button>
            ))}
          </div>
        </div>

        <button className={`match-btn ${matchMode ? 'active' : ''}`} onClick={onMatchToggle}>
          <Crosshair size={13} strokeWidth={2} />
          {matchMode ? 'Match ON' : 'Match OFF'}
        </button>
      </div>
    </div>
  );
}
