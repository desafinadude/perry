import { useState, useEffect, useRef } from 'react'

export interface MidiInput {
  id: string
  name: string
}

interface MidiHandlers {
  onNoteOn: (note: number, velocity: number) => void
  onNoteOff: (note: number) => void
  onCC: (cc: number, value: number) => void
  onPitchBend: (value: number) => void
}

export function useMidi(handlers: MidiHandlers) {
  const [inputs, setInputs] = useState<MidiInput[]>([])
  const [supported, setSupported] = useState(true)
  const accessRef = useRef<MIDIAccess | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const attachAll = useRef(() => {
    const access = accessRef.current
    if (!access) return
    for (const input of access.inputs.values()) {
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const raw = e.data || new Uint8Array(0)
        const bytes = new Uint8Array(raw as unknown as ArrayBufferLike)
        const status = bytes[0]
        const byte1 = bytes[1]
        const byte2 = bytes[2]
        const type = status & 0xf0
        if (type === 0x90 && byte2 > 0) {
          handlersRef.current.onNoteOn(byte1, byte2)
        } else if (type === 0x80 || (type === 0x90 && byte2 === 0)) {
          handlersRef.current.onNoteOff(byte1)
        } else if (type === 0xb0) {
          handlersRef.current.onCC(byte1, byte2)
        } else if (type === 0xe0) {
          const value = ((byte2 & 0x7f) << 7) | (byte1 & 0x7f)
          handlersRef.current.onPitchBend(value)
        }
      }
    }
  })

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
        attachAll.current()
      }
      refreshInputs()
      access.onstatechange = refreshInputs
    }).catch(() => setSupported(false))
  }, [])

  return { inputs, supported }
}
