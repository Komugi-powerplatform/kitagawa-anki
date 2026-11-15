import { State, type CardRec, type LogRec } from './card'

export interface QueueOptions {
  newPerDay: number
  deckId?: string
}

/** 1日の区切り（Anki と同じく朝4時） */
export const ROLLOVER_HOUR = 4

export function dayStart(now: Date): Date {
  const d = new Date(now)
  if (d.getHours() < ROLLOVER_HOUR) d.setDate(d.getDate() - 1)
  d.setHours(ROLLOVER_HOUR, 0, 0, 0)
  return d
}

function newIntroducedToday(logs: LogRec[], now: Date): number {
  const start = dayStart(now).getTime()
  return logs.filter((l) => l.wasNew && new Date(l.at).getTime() >= start).length
}

function isDue(c: CardRec, now: Date): boolean {
  return c.sched.reps > 0 && new Date(c.sched.dueAt).getTime() <= now.getTime()
}

function byDue(a: CardRec, b: CardRec): number {
  return new Date(a.sched.dueAt).getTime() - new Date(b.sched.dueAt).getTime()
}

function newCards(cards: CardRec[], logs: LogRec[], now: Date, newPerDay: number): CardRec[] {
  const room = Math.max(0, newPerDay - newIntroducedToday(logs, now))
  return cards
    .filter((c) => c.sched.reps === 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, room)
}

/** 今出すカードの並び：期限が来た学習中・復習カード（期限の古い順）→ 新規カード（1日の上限まで） */
export function buildQueue(cards: CardRec[], logs: LogRec[], now: Date, opts: QueueOptions): CardRec[] {
  const pool = opts.deckId ? cards.filter((c) => c.deckId === opts.deckId) : cards
  const due = pool.filter((c) => isDue(c, now)).sort(byDue)
  return [...due, ...newCards(pool, logs, now, opts.newPerDay)]
}

export interface DeckCounts {
  new: number
  learning: number
  review: number
  total: number
}

export function countsForDeck(cards: CardRec[], logs: LogRec[], now: Date, opts: QueueOptions): DeckCounts {
  const pool = opts.deckId ? cards.filter((c) => c.deckId === opts.deckId) : cards
  const due = pool.filter((c) => isDue(c, now))
  return {
    new: newCards(pool, logs, now, opts.newPerDay).length,
    learning: due.filter((c) => c.sched.state === State.Learning || c.sched.state === State.Relearning).length,
    review: due.filter((c) => c.sched.state === State.Review).length,
    total: pool.length,
  }
}

/** 今は出すカードが無いとき、次に出題できる学習中カードの時刻（今日のうちに来るもの） */
export function nextLearningDue(cards: CardRec[], now: Date, deckId?: string): Date | null {
  const end = dayStart(now).getTime() + 24 * 3_600_000
  const times = cards
    .filter((c) => (!deckId || c.deckId === deckId) && c.sched.reps > 0)
    .map((c) => new Date(c.sched.dueAt).getTime())
    .filter((t) => t > now.getTime() && t < end)
  return times.length ? new Date(Math.min(...times)) : null
}
