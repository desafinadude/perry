import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Zone } from '../../types'
import type { ChannelMix, JamStrip, MixerSettings } from '../../mixer/model'
import { DELAY_SYNCS, defaultMix, mixOf, syncSeconds } from '../../mixer/model'
import { Knob } from '../Knob'
import { h1, h2, headText, lbl } from '../controls'
import { fmtHz, fmtPan } from '../format'
import { Fader } from './Fader'

type Meters = {
  strips: Record<string, number>
  jam: Partial<Record<JamStrip, number>>
  buses: { reverb: number; delay: number; chorus: number }
  master: { l: number; r: number; reduction: number }
}

interface Props {
  zones: Zone[]
  mixer: MixerSettings
  onMixer: (m: MixerSettings) => void
  /** Update the strip shared by every zone with this stream key. */
  onZoneMix: (key: string, mix: ChannelMix) => void
  chainKeyFor: (z: Zone) => string
  readMeters: () => Meters
  active: boolean
  /** Current JAM tempo (for synced delay). */
  bpm: number
  /** Which JAM parts currently use built-in sounds. */
  jamBuiltin: Record<'drums' | 'bass' | 'keys', boolean>
}

const SILENT: Meters = { strips: {}, jam: {}, buses: { reverb: -Infinity, delay: -Infinity, chorus: -Infinity }, master: { l: -Infinity, r: -Infinity, reduction: 0 } }
// Shared vertical rhythm so every fader in the console starts on the same line
const HEAD_H = 58
const CONTROLS_H = 246
const FADER_H = 236

const JAM_LABELS: Record<JamStrip, [string, string]> = {
  drums: ['DRUMS', 'BUILT-IN KIT'], bass: ['BASS', 'BUILT-IN BASS'], keys: ['KEYS', 'BUILT-IN KEYS'], click: ['CLICK', 'JAM METRONOME'],
}

/** Console view: zone strips, JAM band strips, FX returns, master. */
export function MixerView({ zones, mixer, onMixer, onZoneMix, chainKeyFor, readMeters, active, bpm, jamBuiltin }: Props) {
  const [meters, setMeters] = useState<Meters>(SILENT)
  useEffect(() => {
    if (!active) return
    let raf = 0, last = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 33) return // ~30 fps is plenty for meters
      last = t
      setMeters(readMeters())
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active, readMeters])

  // one strip per audio stream: zones sharing a soundfont channel share one
  const zoneStrips = useMemo(() => {
    const m = new Map<string, Zone[]>()
    for (const z of zones) {
      const k = chainKeyFor(z)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(z)
    }
    return [...m.entries()].map(([key, zs]) => {
      const owner = zs.find((z) => z.mix || z.effects) ?? zs[0]
      return { key, zones: zs, mix: mixOf(owner) }
    })
  }, [zones, chainKeyFor])

  const jamStrips = (['drums', 'bass', 'keys', 'click'] as JamStrip[]).filter((k) => k === 'click' || jamBuiltin[k])
  const anySolo = zoneStrips.some((s) => s.mix.solo) || jamStrips.some((k) => mixer.jam[k].solo)
  const setJam = (k: JamStrip, mix: ChannelMix) => onMixer({ ...mixer, jam: { ...mixer.jam, [k]: mix } })
  const delaySecs = mixer.delay.sync ? syncSeconds(mixer.delay.sync, bpm) : mixer.delay.time

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, padding: '12px 24px 10px', borderBottom: '2px solid var(--ink)', flexWrap: 'wrap' }}>
        <span style={h1}>MIXER</span>
        <span style={{ ...lbl }}>SAVED WITH ZONE CONFIGS</span>
        <span style={{ flex: 1 }} />
        <span style={lbl}>SENDS ARE POST-FADER · DOUBLE-CLICK A CONTROL TO RESET</span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'auto', minHeight: 0 }}>
        <Group name="ZONES">
          {zoneStrips.length === 0 && <div style={{ ...lbl, padding: 20, width: 200, whiteSpace: 'normal' }}>NO ZONES YET — ADD ONE ON THE ZONES TAB</div>}
          {zoneStrips.map((s) => {
            const z = s.zones[0]
            const engine = z.engine ?? 'soundfont'
            const source = engine === 'synth' ? 'SYNTH' : engine === 'sampler' ? `SAMPLE · ${(z.sampler?.fileName ?? '').toUpperCase()}` : `SF2 · CH ${z.channel + 1}${z.drums ? ' · KIT' : ''}`
            return (
              <Strip
                key={s.key}
                name={s.zones.map((x) => x.name).join(' + ').toUpperCase()}
                source={source}
                color={z.color}
                mix={s.mix}
                silenced={s.mix.mute || (anySolo && !s.mix.solo)}
                meter={meters.strips[s.key] ?? -Infinity}
                onChange={(m) => onZoneMix(s.key, m)}
              />
            )
          })}
        </Group>

        <Group name="JAM BAND · BUILT-IN">
          {jamStrips.map((k) => (
            <Strip
              key={k}
              name={JAM_LABELS[k][0]}
              source={JAM_LABELS[k][1]}
              color={k === 'click' ? '#8E8B82' : 'var(--ink)'}
              mix={mixer.jam[k]}
              silenced={mixer.jam[k].mute || (anySolo && !mixer.jam[k].solo)}
              meter={meters.jam[k] ?? -Infinity}
              onChange={(m) => setJam(k, m)}
            />
          ))}
        </Group>

        <Group name="FX RETURNS" tone="var(--bypass)">
          <ReturnStrip name="REVERB" bus="BUS A" level={mixer.reverb.level} mute={mixer.reverb.mute} meter={meters.buses.reverb}
            onLevel={(level) => onMixer({ ...mixer, reverb: { ...mixer.reverb, level } })}
            onMute={() => onMixer({ ...mixer, reverb: { ...mixer.reverb, mute: !mixer.reverb.mute } })}>
            <Knob compact size={40} label="SIZE" value={mixer.reverb.size} min={0} max={1} defaultValue={0.55} onChange={(v) => onMixer({ ...mixer, reverb: { ...mixer.reverb, size: v } })} display={(v) => `${(0.4 + v * 5.6).toFixed(1)}s`} />
            <Knob compact size={40} label="DECAY" value={mixer.reverb.decay} min={0} max={1} defaultValue={0.5} onChange={(v) => onMixer({ ...mixer, reverb: { ...mixer.reverb, decay: v } })} display={(v) => `${Math.round(v * 100)}%`} />
            <Knob compact size={40} label="PRE" value={mixer.reverb.predelay} min={0} max={0.2} step={0.001} defaultValue={0.02} onChange={(v) => onMixer({ ...mixer, reverb: { ...mixer.reverb, predelay: v } })} display={(v) => `${Math.round(v * 1000)}ms`} />
            <Knob compact size={40} label="TONE" value={mixer.reverb.tone} min={800} max={16000} curve="log" defaultValue={6000} onChange={(v) => onMixer({ ...mixer, reverb: { ...mixer.reverb, tone: v } })} display={fmtHz} />
          </ReturnStrip>

          <ReturnStrip name="DELAY" bus="BUS B" level={mixer.delay.level} mute={mixer.delay.mute} meter={meters.buses.delay}
            onLevel={(level) => onMixer({ ...mixer, delay: { ...mixer.delay, level } })}
            onMute={() => onMixer({ ...mixer, delay: { ...mixer.delay, mute: !mixer.delay.mute } })}
            caption={`${Math.round(delaySecs * 1000)} MS${mixer.delay.sync ? ` · ${mixer.delay.sync} @ ${Math.round(bpm)} BPM` : ''}`}
            footer={
              <select aria-label="Delay sync" value={mixer.delay.sync ?? ''} onChange={(e) => onMixer({ ...mixer, delay: { ...mixer.delay, sync: (e.target.value || null) as typeof mixer.delay.sync } })}
                style={{ height: 26, width: 78, border: '1.5px solid var(--ink)', background: mixer.delay.sync ? 'var(--accent-1)' : '#fff', color: mixer.delay.sync ? '#fff' : 'var(--ink)', fontSize: 10, borderRadius: 0, padding: '0 4px' }}>
                <option value="">FREE</option>
                {DELAY_SYNCS.map((x) => <option key={x} value={x}>SYNC {x}</option>)}
              </select>
            }>
            <Knob compact size={40} dimmed={!!mixer.delay.sync} label="TIME" value={mixer.delay.time} min={0.02} max={2} curve="log" defaultValue={0.32} onChange={(v) => onMixer({ ...mixer, delay: { ...mixer.delay, time: v, sync: null } })} display={(v) => `${Math.round(v * 1000)}ms`} />
            <Knob compact size={40} label="FDBK" value={mixer.delay.feedback} min={0} max={0.92} defaultValue={0.35} onChange={(v) => onMixer({ ...mixer, delay: { ...mixer.delay, feedback: v } })} display={(v) => `${Math.round(v * 100)}%`} />
            <Knob compact size={40} label="TONE" value={mixer.delay.tone} min={800} max={16000} curve="log" defaultValue={3500} onChange={(v) => onMixer({ ...mixer, delay: { ...mixer.delay, tone: v } })} display={fmtHz} />
            <Knob compact size={40} label="WIDTH" value={mixer.delay.width} min={0} max={1} defaultValue={0.6} onChange={(v) => onMixer({ ...mixer, delay: { ...mixer.delay, width: v } })} display={(v) => `${Math.round(v * 100)}%`} />
          </ReturnStrip>

          <ReturnStrip name="CHORUS" bus="BUS C" level={mixer.chorus.level} mute={mixer.chorus.mute} meter={meters.buses.chorus}
            onLevel={(level) => onMixer({ ...mixer, chorus: { ...mixer.chorus, level } })}
            onMute={() => onMixer({ ...mixer, chorus: { ...mixer.chorus, mute: !mixer.chorus.mute } })}>
            <Knob compact size={40} label="RATE" value={mixer.chorus.rate} min={0.05} max={6} step={0.01} defaultValue={0.8} onChange={(v) => onMixer({ ...mixer, chorus: { ...mixer.chorus, rate: v } })} display={(v) => `${v.toFixed(2)}Hz`} />
            <Knob compact size={40} label="DEPTH" value={mixer.chorus.depth} min={0} max={1} defaultValue={0.4} onChange={(v) => onMixer({ ...mixer, chorus: { ...mixer.chorus, depth: v } })} display={(v) => `${Math.round(v * 100)}%`} />
          </ReturnStrip>
        </Group>

        {/* empty space keeps MASTER on the far right */}
        <div style={{ flex: 1, minWidth: 0 }} />

        <section aria-label="Master" style={{ display: 'flex', flexDirection: 'column', width: 156, flexShrink: 0, background: '#3A3935', color: 'var(--bg)', position: 'sticky', right: 0, zIndex: 2, boxShadow: '-2px 0 0 var(--ink)' }}>
          <div style={{ height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid #55534D' }}><span style={{ ...headText, fontSize: 13, color: 'var(--bg)' }}>OUTPUT</span></div>
          <div style={{ height: 5, flexShrink: 0, background: 'var(--accent-2)' }} />
          <div style={{ height: HEAD_H, boxSizing: 'border-box', padding: '8px 10px 6px', borderBottom: '1px solid #55534D' }}>
            <div style={h2}>MASTER</div>
            <span style={{ ...lbl, fontSize: 9, color: '#C8C5BB' }}>STEREO · LIMITER</span>
          </div>
          <div style={{ height: CONTROLS_H, boxSizing: 'border-box', padding: '12px 10px', borderBottom: '1px solid #55534D', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ ...lbl, color: '#C8C5BB' }}>LIMITER</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: meters.master.reduction < -0.5 ? '#fbbf24' : '#55534D' }} />
              <span style={{ fontSize: 12, letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums' }}>{meters.master.reduction < -0.05 ? `${meters.master.reduction.toFixed(1)} dB GR` : 'NO GR'}</span>
            </div>
            <div aria-hidden="true" style={{ height: 6, background: '#55534D', position: 'relative' }}>
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${Math.min(100, -meters.master.reduction * 8)}%`, background: '#fbbf24' }} />
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '14px 0 10px' }}>
            <Fader label="Master" db={mixer.master.level} onChange={(level) => onMixer({ ...mixer, master: { level } })}
              meters={[meters.master.l, meters.master.r]} height={FADER_H} width={42} cap="var(--bg)" capLine="var(--accent-2)" dark />
          </div>
        </section>
      </div>
    </div>
  )
}

function Group({ name, children, tone }: { name: string; children: ReactNode; tone?: string }) {
  return (
    <section aria-label={name} style={{ display: 'flex', flexDirection: 'column', borderRight: '2px solid var(--ink)', background: tone, flexShrink: 0 }}>
      <div style={{ height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid var(--border)', background: tone ? '#DCD9CF' : 'var(--surface)' }}>
        <span style={{ ...headText, fontSize: 13 }}>{name}</span>
      </div>
      <div style={{ display: 'flex', flex: 1 }}>{children}</div>
    </section>
  )
}

function StripHead({ name, sub, color, dim }: { name: string; sub: string; color: string; dim?: boolean }) {
  return (
    <>
      <div style={{ height: 5, flexShrink: 0, background: color }} />
      <div style={{ height: HEAD_H, boxSizing: 'border-box', padding: '8px 9px 6px', display: 'flex', flexDirection: 'column', gap: 3, borderBottom: '1px solid var(--border)' }}>
        <span title={name} style={{ ...h2, color: dim ? 'var(--label)' : 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        <span style={{ ...lbl, fontSize: 9, letterSpacing: '0.1em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
      </div>
    </>
  )
}

function Strip({ name, source, color, mix, silenced, meter, onChange }: {
  name: string; source: string; color: string; mix: ChannelMix; silenced: boolean; meter: number; onChange: (m: ChannelMix) => void
}) {
  const set = <K extends keyof ChannelMix>(k: K, v: ChannelMix[K]) => onChange({ ...mix, [k]: v })
  const d = defaultMix()
  const gain = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dB`
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return (
    <div style={{ width: 132, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: silenced ? 'var(--bypass)' : 'transparent' }}>
      <StripHead name={name} sub={source} color={color} dim={silenced} />

      <div style={{ height: CONTROLS_H, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '6px 2px 4px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 7px 2px' }}>
            <span style={{ ...lbl, fontSize: 9 }}>EQ</span>
            <button onClick={() => set('filterOn', !mix.filterOn)} title="Filter on/off (settings on the zone page)" style={{ ...lbl, fontSize: 9, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: mix.filterOn ? 'var(--accent-1)' : '#8E8B82' }}>
              {mix.filterOn ? `${mix.filterType === 'lowpass' ? 'LP' : mix.filterType === 'highpass' ? 'HP' : 'BP'} ${fmtHz(mix.cutoff)}` : 'FILTER OFF'}
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Knob compact size={34} bipolar label="LOW" value={mix.eqLow} min={-12} max={12} step={0.5} defaultValue={d.eqLow} onChange={(v) => set('eqLow', v)} display={gain} />
            <Knob compact size={34} bipolar label="MID" value={mix.eqMid} min={-12} max={12} step={0.5} defaultValue={d.eqMid} onChange={(v) => set('eqMid', v)} display={gain} />
            <Knob compact size={34} bipolar label="HIGH" value={mix.eqHigh} min={-12} max={12} step={0.5} defaultValue={d.eqHigh} onChange={(v) => set('eqHigh', v)} display={gain} />
          </div>
        </div>

        <div style={{ padding: '6px 2px 4px', borderBottom: '1px solid var(--border)', background: '#EEF3F9' }}>
          <div style={{ padding: '0 7px 2px' }}><span style={{ ...lbl, fontSize: 9, color: 'var(--accent-1)' }}>SENDS</span></div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Knob compact size={34} label="REV" value={mix.sendRev} min={0} max={1} defaultValue={0} onChange={(v) => set('sendRev', v)} display={pct} />
            <Knob compact size={34} label="DLY" value={mix.sendDly} min={0} max={1} defaultValue={0} onChange={(v) => set('sendDly', v)} display={pct} />
            <Knob compact size={34} label="CHO" value={mix.sendCho} min={0} max={1} defaultValue={0} onChange={(v) => set('sendCho', v)} display={pct} />
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Knob compact size={40} bipolar label="PAN" value={mix.pan} min={-1} max={1} step={0.01} defaultValue={0} onChange={(v) => set('pan', v)} display={fmtPan} />
            <span style={{ fontSize: 10, fontWeight: 500 }}>{fmtPan(mix.pan)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button aria-pressed={mix.mute} aria-label={`Mute ${name}`} onClick={() => set('mute', !mix.mute)} style={msBtn(mix.mute, 'var(--ink)')}>M</button>
            <button aria-pressed={mix.solo} aria-label={`Solo ${name}`} onClick={() => set('solo', !mix.solo)} style={msBtn(mix.solo, 'var(--accent-1)')}>S</button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '14px 0 10px' }}>
        <Fader label={name} db={mix.level} onChange={(v) => set('level', v)} meters={[meter]} height={FADER_H} />
      </div>
    </div>
  )
}

function ReturnStrip({ name, bus, level, mute, meter, onLevel, onMute, children, caption, footer }: {
  name: string; bus: string; level: number; mute: boolean; meter: number
  onLevel: (db: number) => void; onMute: () => void; children: ReactNode
  /** Small line under the knobs (e.g. the delay time in use). */
  caption?: string
  /** Extra control beside the mute button (e.g. delay sync). */
  footer?: ReactNode
}) {
  return (
    <div style={{ width: 150, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: mute ? '#D6D3C9' : 'transparent' }}>
      <StripHead name={name} sub={`${bus} · 100% WET`} color="var(--accent-1)" />
      <div style={{ height: CONTROLS_H, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
        <div style={{ flex: 1, padding: '10px 6px 4px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', rowGap: 8, justifyItems: 'center', alignContent: 'start' }}>
          {children}
          {caption && <span style={{ ...lbl, fontSize: 9, gridColumn: '1 / -1', textAlign: 'center', whiteSpace: 'normal' }}>{caption}</span>}
        </div>
        <div style={{ height: 44, boxSizing: 'border-box', padding: '0 9px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          {footer ?? <span />}
          <button aria-pressed={mute} aria-label={`Mute ${name} return`} onClick={onMute} style={msBtn(mute, 'var(--ink)')}>M</button>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '14px 0 10px' }}>
        <Fader label={`${name} return`} db={level} onChange={onLevel} meters={[meter]} height={FADER_H} cap="var(--accent-1)" capLine="var(--bg)" />
      </div>
    </div>
  )
}

const msBtn = (on: boolean, c: string): CSSProperties => ({
  width: 32, height: 26, border: '1.5px solid var(--ink)', borderRadius: 0, cursor: 'pointer',
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
  background: on ? c : 'transparent', color: on ? '#fff' : 'var(--ink)',
})

