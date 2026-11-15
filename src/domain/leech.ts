import type { CardRec } from './card'

/** 忘れた回数がこの回数に達したカードを「リーチ」として止める（Anki の初期値と同じ） */
export const LEECH_THRESHOLD = 8

/**
 * 答えたあとのカードにリーチの判定をかける。Anki と同じく、8回目で止め、
 * 再開したあとはさらに半分（4回）忘れるごとにまた止める。
 */
export function applyLeech(before: CardRec, after: CardRec): { card: CardRec; leeched: boolean } {
  const lapses = after.sched.lapses
  const forgot = lapses > before.sched.lapses
  const step = Math.ceil(LEECH_THRESHOLD / 2)
  const hit = forgot && lapses >= LEECH_THRESHOLD && (lapses - LEECH_THRESHOLD) % step === 0
  return hit ? { card: { ...after, suspended: true, leech: true }, leeched: true } : { card: after, leeched: false }
}
