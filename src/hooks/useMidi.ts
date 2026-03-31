import { useState, useEffect, useRef, useCallback } from 'react'

export interface MidiInput {
  id: string
  name: string
}

interface MidiHandlers {
  onNoteOn: (note: number, velocity: number) => void
  onNoteOff: (note: number) => void
  onCC: (cc: number, value: number) => void
  onPitchBend: (value: number) => void  // 0–16383, center 8192
}

export function useMidi(handlers: MidiHandlers) {
  const [inputs, setInputs] = useState<MidiInput[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)
  const accessRef = useRef<MIDIAccess | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setSupported(false)
      return
    }
    navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      accessRef.current = access
      const refreshInputs = () => {
        const list: MidiInput[] = []
        for (const input of access.inputs.values()) {
          list.push({ id: input.id, name: input.name ?? input.id })
        }
        setInputs(list)
        if (list.length > 0 && !selectedId) setSelectedId(list[0].id)
      }
      refreshInputs()
      access.onstatechange = refreshInputs
    }).catch(() => setSupported(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const access = accessRef.current
    if (!access || !selectedId) return

    const onMessage = (e: MIDIMessageEvent) => {
      const [status, byte1, byte2] = e.data
      const type = status & 0xf0
      if (type === 0x90 && byte2 > 0) {
        handlersRef.current.onNoteOn(byte1, byte2)
      } else if (type === 0x80 || (type === 0x90 && byte2 === 0)) {
        handlersRef.current.onNoteOff(byte1)
      } else if (type === 0xb0) {
        handlersRef.current.onCC(byte1, byte2)
      } else if (type === 0xe0) {
        // Pitch bend: 14-bit value, LSB in byte1, MSB in byte2
        const value = ((byte2 & 0x7f) << 7) | (byte1 & 0x7f)
        handlersRef.current.onPitchBend(value)
      }
    }

    for (const input of access.inputs.values()) input.onmidimessage = null
    const selected = access.inputs.get(selectedId)
    if (selected) selected.onmidimessage = onMessage
    return () => { if (selected) selected.onmidimessage = null }
  }, [selectedId])

  const selectInput = useCallback((id: string) => setSelectedId(id), [])
  return { inputs, selectedId, selectInput, supported }
}
