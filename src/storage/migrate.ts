import { newId, type AppData, type CardRec, type Note } from '../domain/card'

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isV2(v: Record<string, unknown>): boolean {
  return (
    v.version === 2 &&
    Array.isArray(v.decks) &&
    Array.isArray(v.notes) &&
    Array.isArray(v.cards) &&
    Array.isArray(v.logs) &&
    v.notes.every((n) => isObj(n) && typeof n.id === 'string' && typeof n.front === 'string' && typeof n.type === 'string') &&
    v.cards.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.noteId === 'string' && isObj(c.sched))
  )
}

function isV1(v: Record<string, unknown>): boolean {
  return (
    v.version === 1 &&
    Array.isArray(v.decks) &&
    Array.isArray(v.cards) &&
    Array.isArray(v.logs) &&
    v.cards.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.front === 'string' && isObj(c.sched))
  )
}

/**
 * 保存データ・バックアップを今の形（version 2）にする。読めない形なら null。
 * version 1（第1弾）はカード1枚を「基本ノート1つ＋カード1枚」にする。カードID・出題予定・回答記録はそのまま。
 */
export function migrate(raw: unknown): AppData | null {
  if (!isObj(raw)) return null
  if (isV2(raw)) return raw as unknown as AppData
  if (!isV1(raw)) return null
  const notes: Note[] = []
  const cards: CardRec[] = []
  for (const c of raw.cards as Record<string, unknown>[]) {
    const note: Note = { id: newId(), deckId: String(c.deckId), type: 'basic', front: String(c.front), back: String(c.back ?? ''), createdAt: String(c.createdAt) }
    notes.push(note)
    cards.push({ id: String(c.id), noteId: note.id, deckId: note.deckId, ord: 0, createdAt: note.createdAt, sched: c.sched as CardRec['sched'] })
  }
  return { version: 2, decks: raw.decks as AppData['decks'], notes, cards, logs: raw.logs as AppData['logs'] }
}
