import { newId, type AppData, type CardRec, type Deck } from '../domain/card'
import type { Scheduler } from '../domain/scheduler'

export const SEED_FORMAT = 'kitagawa-anki-seed'

export function emptyData(): AppData {
  return { version: 1, decks: [], cards: [], logs: [] }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function isAppData(v: unknown): v is AppData {
  return (
    isObj(v) &&
    v.version === 1 &&
    Array.isArray(v.decks) &&
    Array.isArray(v.cards) &&
    Array.isArray(v.logs) &&
    v.cards.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.front === 'string' && isObj(c.sched))
  )
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

export type ImportResult = { ok: true; data: AppData; added: number } | { ok: false; error: string }

/**
 * 取り込み。2種類を受け付ける。
 * - バックアップ（exportJson の出力）: 今のデータを丸ごと置き換える
 * - Anki から書き出したカード（format: kitagawa-anki-seed）: 新規カードとして足す。同じデッキに同じ表・裏があれば足さない
 */
export function importJson(text: string, current: AppData, scheduler: Scheduler, now: Date): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON として読めないファイルです。' }
  }

  if (isAppData(parsed)) return { ok: true, data: parsed, added: parsed.cards.length }
  if (!isSeed(parsed)) return { ok: false, error: 'KitagawaAnki のバックアップでも、Anki から書き出したカードでもありません。' }

  const bad = parsed.cards.findIndex(
    (c) => !isObj(c) || typeof c.deck !== 'string' || !c.deck.trim() || typeof c.front !== 'string' || !c.front.trim() || typeof c.back !== 'string',
  )
  if (bad >= 0) return { ok: false, error: `${bad + 1}枚目のカードに、デッキ名か表の文字がありません。` }

  const decks: Deck[] = [...current.decks]
  const cards: CardRec[] = [...current.cards]
  const deckIdByName = new Map(decks.map((d) => [d.name, d.id]))
  const existing = new Set(cards.map((c) => `${c.deckId}\u0000${c.front}\u0000${c.back}`))
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
    const createdAt = new Date(now.getTime() + i).toISOString()
    cards.push({ id: newId(), deckId, front: c.front, back: c.back, createdAt, sched: scheduler.newSched(now) })
    added++
  })

  return { ok: true, data: { ...current, decks, cards }, added }
}
