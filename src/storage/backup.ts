import { newId, type AppData, type CardRec, type Deck, type Note } from '../domain/card'
import { syncCards } from '../domain/note'
import type { Scheduler } from '../domain/scheduler'
import { migrate } from './migrate'

export const SEED_FORMAT = 'kitagawa-anki-seed'

export function emptyData(): AppData {
  return { version: 2, decks: [], notes: [], cards: [], logs: [] }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

interface SeedCard {
  deck: string
  front: string
  back: string
}

function isSeed(v: unknown): v is { format: string; cards: SeedCard[] } {
  return isObj(v) && v.format === SEED_FORMAT && Array.isArray(v.cards)
}

export function exportJson(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export type ImportResult = { ok: true; data: AppData; added: number; kind: 'replace' | 'merge' } | { ok: false; error: string }

/**
 * 取り込み。2種類を受け付ける。
 * - バックアップ（exportJson の出力。第1弾の形も可）: 今のデータを丸ごと置き換える
 * - Anki から書き出したカード（format: kitagawa-anki-seed）: 基本ノートとして足す。同じデッキに同じ表・裏があれば足さない
 */
export function importJson(text: string, current: AppData, scheduler: Scheduler, now: Date): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON として読めないファイルです。' }
  }

  const backup = isObj(parsed) && 'version' in parsed ? migrate(parsed) : null
  if (backup) return { ok: true, data: backup, added: backup.cards.length, kind: 'replace' }
  if (!isSeed(parsed)) return { ok: false, error: 'KitagawaAnki のバックアップでも、Anki から書き出したカードでもありません。' }

  const bad = parsed.cards.findIndex(
    (c) => !isObj(c) || typeof c.deck !== 'string' || !c.deck.trim() || typeof c.front !== 'string' || !c.front.trim() || typeof c.back !== 'string',
  )
  if (bad >= 0) return { ok: false, error: `${bad + 1}枚目のカードに、デッキ名か表の文字がありません。` }

  const decks: Deck[] = [...current.decks]
  const notes: Note[] = [...current.notes]
  const cards: CardRec[] = [...current.cards]
  const deckIdByName = new Map(decks.map((d) => [d.name, d.id]))
  const existing = new Set(notes.map((n) => `${n.deckId}\u0000${n.front}\u0000${n.back}`))
  let added = 0

  parsed.cards.forEach((c, i) => {
    const deckName = c.deck.trim()
    let deckId = deckIdByName.get(deckName)
    if (!deckId) {
      deckId = newId()
      deckIdByName.set(deckName, deckId)
      decks.push({ id: deckId, name: deckName })
    }
    const key = `${deckId}\u0000${c.front}\u0000${c.back}`
    if (existing.has(key)) return
    existing.add(key)
    // 並び順を元のファイルどおりに保つため、作成時刻を1ミリ秒ずつずらす
    const note: Note = { id: newId(), deckId, type: 'basic', front: c.front, back: c.back, createdAt: new Date(now.getTime() + i).toISOString() }
    notes.push(note)
    cards.push(...syncCards(note, [], scheduler, now))
    added++
  })

  return { ok: true, data: { ...current, decks, notes, cards }, added, kind: 'merge' }
}

/** カードが無くなったデッキを外す */
export function pruneDecks(data: AppData): AppData {
  const used = new Set(data.cards.map((c) => c.deckId))
  return { ...data, decks: data.decks.filter((d) => used.has(d.id)) }
}

/** ノートとそのカードを消す。回答記録は残す（消すとその日の新規枠が戻ってしまうため）。カードが無くなったデッキは消す */
export function removeNote(data: AppData, noteId: string): AppData {
  return pruneDecks({ ...data, notes: data.notes.filter((n) => n.id !== noteId), cards: data.cards.filter((c) => c.noteId !== noteId) })
}

/** デッキと中のノート・カードを消す（回答記録は残す） */
export function removeDeck(data: AppData, deckId: string): AppData {
  return { ...data, decks: data.decks.filter((d) => d.id !== deckId), notes: data.notes.filter((n) => n.deckId !== deckId), cards: data.cards.filter((c) => c.deckId !== deckId) }
}
