import { State, type AppData, type CardRec, type Deck, type LogRec } from './card'

export interface Limits {
  newPerDay: number
  reviewPerDay: number
}

export interface QueueOptions {
  /** デッキに上限が設定されていないときに使う値 */
  defaults: Limits
  deckId?: string
}

/** 1日の区切り（Anki と同じく朝4時） */
export const ROLLOVER_HOUR = 4
const DAY_MS = 24 * 3_600_000

export function dayStart(now: Date): Date {
  const d = new Date(now)
  if (d.getHours() < ROLLOVER_HOUR) d.setDate(d.getDate() - 1)
  d.setHours(ROLLOVER_HOUR, 0, 0, 0)
  return d
}

/** 翌朝4時（保留の戻り時刻） */
export function nextDayStart(now: Date): Date {
  return new Date(dayStart(now).getTime() + DAY_MS)
}

export function limitsFor(deck: Deck | undefined, defaults: Limits): Limits {
  return { newPerDay: deck?.newPerDay ?? defaults.newPerDay, reviewPerDay: deck?.reviewPerDay ?? defaults.reviewPerDay }
}

/** 今出してよいカードか（停止・保留中でない） */
function isActive(c: CardRec, now: Date): boolean {
  return !c.suspended && !(c.buried && new Date(c.buried).getTime() > now.getTime())
}

/** 学習中・再学習中は時刻で、復習カードは日単位で判定する（期日の日になれば朝4時から出す。Anki と同じ） */
function isDue(c: CardRec, now: Date): boolean {
  if (c.sched.reps === 0) return false
  const due = new Date(c.sched.dueAt).getTime()
  if (c.sched.state === State.Review) return due < nextDayStart(now).getTime()
  return due <= now.getTime()
}

const isLearning = (c: CardRec) => c.sched.state === State.Learning || c.sched.state === State.Relearning
const byDue = (a: CardRec, b: CardRec) => new Date(a.sched.dueAt).getTime() - new Date(b.sched.dueAt).getTime()
const byCreated = (a: CardRec, b: CardRec) => a.createdAt.localeCompare(b.createdAt) || a.ord - b.ord

function todayLogs(logs: LogRec[], cards: CardRec[], deckId: string, now: Date): LogRec[] {
  const start = dayStart(now).getTime()
  const deckOfCard = new Map(cards.map((c) => [c.id, c.deckId]))
  return logs.filter((l) => new Date(l.at).getTime() >= start && (l.deckId ?? deckOfCard.get(l.cardId)) === deckId)
}

interface DeckQueue {
  learning: CardRec[]
  review: CardRec[]
  fresh: CardRec[]
}

function deckQueue(data: AppData, deckId: string, now: Date, defaults: Limits): DeckQueue {
  const limits = limitsFor(data.decks.find((d) => d.id === deckId), defaults)
  const logs = todayLogs(data.logs, data.cards, deckId, now)
  const doneNew = logs.filter((l) => l.wasNew).length
  const doneReview = logs.filter((l) => l.prevState === State.Review).length
  const pool = data.cards.filter((c) => c.deckId === deckId && isActive(c, now))
  const due = pool.filter((c) => isDue(c, now))
  return {
    learning: due.filter(isLearning),
    review: due.filter((c) => c.sched.state === State.Review).sort(byDue).slice(0, Math.max(0, limits.reviewPerDay - doneReview)),
    fresh: pool.filter((c) => c.sched.reps === 0).sort(byCreated).slice(0, Math.max(0, limits.newPerDay - doneNew)),
  }
}

function collect(data: AppData, now: Date, opts: QueueOptions): DeckQueue {
  const deckIds = opts.deckId ? [opts.deckId] : [...new Set(data.cards.map((c) => c.deckId))]
  const all: DeckQueue = { learning: [], review: [], fresh: [] }
  for (const id of deckIds) {
    const q = deckQueue(data, id, now, opts.defaults)
    all.learning.push(...q.learning)
    all.review.push(...q.review)
    all.fresh.push(...q.fresh)
  }
  return all
}

/** 今出すカードの並び：期限が来た学習中・復習カード（期限の古い順）→ 新規カード（デッキごとの上限まで） */
export function buildQueue(data: AppData, now: Date, opts: QueueOptions): CardRec[] {
  const q = collect(data, now, opts)
  return [...[...q.learning, ...q.review].sort(byDue), ...q.fresh.sort(byCreated)]
}

export interface DeckCounts {
  new: number
  learning: number
  review: number
  total: number
}

export function countsForDeck(data: AppData, now: Date, opts: QueueOptions): DeckCounts {
  const q = collect(data, now, opts)
  const total = data.cards.filter((c) => !opts.deckId || c.deckId === opts.deckId).length
  return { new: q.fresh.length, learning: q.learning.length, review: q.review.length, total }
}

/** 今は出すカードが無いとき、次に出題できる学習中カードの時刻（今日のうちに来るもの） */
export function nextLearningDue(data: AppData, now: Date, deckId?: string): Date | null {
  const end = nextDayStart(now).getTime()
  const times = data.cards
    .filter((c) => (!deckId || c.deckId === deckId) && c.sched.reps > 0 && isLearning(c) && isActive(c, now))
    .map((c) => new Date(c.sched.dueAt).getTime())
    .filter((t) => t > now.getTime() && t < end)
  return times.length ? new Date(Math.min(...times)) : null
}
