import React from 'react'

interface Props {
  visible: boolean
  onClose: () => void
  tuningCents: number
  setTuningCents: (v: number) => void
}

export default function SettingsModal({ visible, onClose, tuningCents, setTuningCents }: Props) {
  if (!visible) return null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ width: 460, background: 'var(--bg)', border: '2px solid var(--ink)', padding: 18, boxShadow: '8px 8px 0 var(--ink)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>Settings</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Global tuning (cents)</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input type="range" min={-50} max={50} step={0.1} value={tuningCents} onChange={(e) => setTuningCents(Number(e.target.value))} style={{ flex: 1 }} />
            <input type="number" value={tuningCents} onChange={(e) => setTuningCents(Number(e.target.value))} step={0.1} style={{ width: 84, padding: '4px 6px' }} />
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>Adjust in cents. Use positive to raise pitch, negative to lower. Value is persisted.</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
          <button onClick={() => { setTuningCents(0) }} style={{ background: 'transparent', border: '1.5px solid var(--ink)', padding: '6px 10px', cursor: 'pointer' }}>Reset</button>
          <button onClick={onClose} style={{ background: 'var(--accent-1)', border: '1.5px solid var(--accent-1)', color: '#fff', padding: '6px 12px', cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
