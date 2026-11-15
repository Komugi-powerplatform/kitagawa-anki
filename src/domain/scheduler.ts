import { DefaultScheduler, Rating } from 'ts-fsrs'
import type { Sched } from './card'

export { Rating }

export type Grade = typeof Rating.Again | typeof Rating.Hard | typeof Rating.Good | typeof Rating.Easy
export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]

export interface PreviewItem {
  rating: Grade
  dueAt: Date
}

export interface ReviewResult {
  sched: Sched
  log: { at: string; rating: Grade; wasNew: boolean; prevState: number }
}

export interface Scheduler {
  newSched(now: Date): Sched
  preview(sched: Sched, now: Date): PreviewItem[]
  review(sched: Sched, rating: Grade, now: Date): ReviewResult
}

const DATE_FIELDS = ['dueAt', 'lastReviewAt'] as const

/** 保存した状態（日時は文字列）を ts-fsrs が受け取れる形（日時は Date）に戻す */
function toFsrsCard(sched: Sched): Record<string, unknown> {
  const card: Record<string, unknown> = { ...sched }
  for (const key of DATE_FIELDS) {
    const v = sched[key]
    card[key] = v == null ? null : new Date(v)
  }
  return card
}

/** ts-fsrs のカードを JSON で保存できる形にする */
function fromFsrsCard(card: Record<string, unknown>): Sched {
  const out: Record<string, unknown> = { ...card }
  for (const key of DATE_FIELDS) {
    const v = card[key]
    out[key] = v instanceof Date ? v.toISOString() : (v ?? null)
  }
  return out as Sched
}

export async function createScheduler(): Promise<Scheduler> {
  // FSRS-6: Anki の FSRS と同じ世代のモデル。目標の記憶率 90%、学習ステップ 1分・10分（Anki の初期設定と同じ）。
  const fsrs = await DefaultScheduler({
    version: 'FSRS-6',
    desiredRetention: 0.9,
    learningSteps: ['1m', '10m'],
    relearningSteps: ['10m'],
    enableFuzz: true,
  })
  // ts-fsrs の型は世代ごとに細かく分かれるため、この境界でだけ緩く扱う
  const f = fsrs as unknown as {
    newCard(o: { now: Date }): Record<string, unknown>
    preview(o: { card: unknown; now: Date }): Iterable<{ grade: number; card: Record<string, unknown> }>
    review(o: { card: unknown; grade: number; now: Date }): { card: Record<string, unknown> }
  }

  return {
    newSched(now) {
      return fromFsrsCard(f.newCard({ now }))
    },
    preview(sched, now) {
      return [...f.preview({ card: toFsrsCard(sched), now })].map((p) => ({
        rating: p.grade as Grade,
        dueAt: p.card.dueAt as Date,
      }))
    },
    review(sched, rating, now) {
      const r = f.review({ card: toFsrsCard(sched), grade: rating, now })
      return {
        sched: fromFsrsCard(r.card),
        log: { at: now.toISOString(), rating, wasNew: sched.reps === 0, prevState: sched.state },
      }
    },
  }
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function round1(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/** 次の出題までの間隔をボタンに出す短い文字にする */
export function formatInterval(ms: number): string {
  if (ms < MIN) return '1分未満'
  if (ms < HOUR) return `${Math.round(ms / MIN)}分`
  if (ms < DAY) return `${round1(ms / HOUR)}時間`
  if (ms < 30 * DAY) return `${Math.round(ms / DAY)}日`
  if (ms < 365 * DAY) return `${round1(ms / (30 * DAY))}か月`
  return `${round1(ms / (365 * DAY))}年`
}
