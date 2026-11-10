import type { CSSProperties } from 'react'
import { displayParts } from '../../jam/chords'

const SIZES = {
  lg: { root: 34, acc: 22, qual: 13, bass: 12, lift: -12 },
  md: { root: 28, acc: 19, qual: 12, bass: 11, lift: -10 },
  sm: { root: 20, acc: 14, qual: 10, bass: 10, lift: -7 },
}

/** Typeset chord: big condensed root, superscript quality, slash bass. */
export function ChordSymbol({ text, size = 'lg', style }: { text: string; size?: keyof typeof SIZES; style?: CSSProperties }) {
  if (text === 'x') return <span style={{ fontFamily: 'var(--font-display)', fontSize: SIZES[size].root, lineHeight: 1, ...style }}>%</span>
  const p = displayParts(text)
  const z = SIZES[size]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', whiteSpace: 'nowrap', ...style }} aria-label={text === 'n' ? 'no chord' : text}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: z.root, lineHeight: 1 }}>{p.root}</span>
      {p.acc && <span style={{ fontFamily: 'var(--font-display)', fontSize: z.acc, lineHeight: 1 }}>{p.acc}</span>}
      {p.qual && <span style={{ fontFamily: 'var(--font-mono)', fontSize: z.qual, fontWeight: 600, position: 'relative', top: z.lift, marginLeft: 1 }}>{p.qual}</span>}
      {p.bass && <span style={{ fontFamily: 'var(--font-mono)', fontSize: z.bass, marginLeft: 2 }}>{p.bass}</span>}
    </span>
  )
}
