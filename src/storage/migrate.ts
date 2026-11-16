import { newId, type AppData, type CardRec, type Deck, type Note } from '../domain/card'

const NOTE_TYPES = new Set(['basic', 'reverse', 'cloze'])

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
    v.notes.every((n) => isObj(n) && typeof n.id === 'string' && typeof n.deckId === 'string' && typeof n.front === 'string' && typeof n.back === 'string' && NOTE_TYPES.has(n.type as string)) &&
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
  if (isV2(raw)) return normalize(raw as unknown as AppData)
  if (!isV1(raw)) return null
  const notes: Note[] = []
  const cards: CardRec[] = []
  for (const c of raw.cards as Record<string, unknown>[]) {
    const note: Note = { id: newId(), deckId: String(c.deckId), type: 'basic', front: String(c.front), back: String(c.back ?? ''), createdAt: String(c.createdAt) }
    notes.push(note)
    cards.push({ id: String(c.id), noteId: note.id, deckId: note.deckId, ord: 0, createdAt: note.createdAt, sched: c.sched as CardRec['sched'] })
  }
  return normalize({ version: 2, decks: raw.decks as AppData['decks'], notes, cards, logs: raw.logs as AppData['logs'] })
}

/**
 * ノート・カード・デッキの食い違いを直す。
 * - ノートの無いカードは外す（出しても表示できず、復習が止まるため）
 * - カードのデッキはノートのデッキにそろえる
 * - ノートが使っているのに無いデッキは作り直す。カードの無いデッキは外す
 */
export function normalize(data: AppData): AppData {
  const notesById = new Map(data.notes.map((n) => [n.id, n]))
  const cards = data.cards.filter((c) => notesById.has(c.noteId)).map((c) => {
    const deckId = notesById.get(c.noteId)!.deckId
    return c.deckId === deckId ? c : { ...c, deckId }
  })
  const withCards = new Set(cards.map((c) => c.noteId))
  const notes = data.notes.filter((n) => withCards.has(n.id))
  const used = new Set(notes.map((n) => n.deckId))
  const decks: Deck[] = data.decks.filter((d) => used.has(d.id))
  for (const id of used) if (!decks.some((d) => d.id === id)) decks.push({ id, name: `復元したデッキ ${decks.length + 1}` })
  const same = cards.length === data.cards.length && notes.length === data.notes.length && decks.length === data.decks.length && cards.every((c, i) => c === data.cards[i])
  return same ? data : { ...data, decks, notes, cards }
}
