import { describe, expect, it } from 'vitest'
import { applyLeech, LEECH_THRESHOLD } from '../src/domain/leech'
import type { CardRec } from '../src/domain/card'

function card(lapses: number, extra: Partial<CardRec> = {}): CardRec {
  return { id: 'c', noteId: 'n', deckId: 'd', ord: 0, createdAt: '2026-11-01T00:00:00Z', sched: { dueAt: '2026-11-16T00:00:00Z', lastReviewAt: null, reps: 10, lapses, state: 3 }, ...extra }
}

describe('applyLeech（Anki と同じく8回忘れたら停止）', () => {
  it('しきい値は8回', () => {
    expect(LEECH_THRESHOLD).toBe(8)
  })

  it('忘れた回数が8回目に達したら、停止してリーチの印を付ける', () => {
    const r = applyLeech(card(7), card(8))
    expect(r.leeched).toBe(true)
    expect(r.card.suspended).toBe(true)
    expect(r.card.leech).toBe(true)
  })

  it('7回目までは何もしない', () => {
    const r = applyLeech(card(6), card(7))
    expect(r.leeched).toBe(false)
    expect(r.card.suspended).toBeUndefined()
  })

  it('忘れていない答え（回数が増えていない）では何もしない', () => {
    expect(applyLeech(card(8, { leech: true }), card(8, { leech: true })).leeched).toBe(false)
  })

  it('再開したあとは、さらに4回忘れるごとにまた止める（12回目・16回目）', () => {
    expect(applyLeech(card(9, { leech: true }), card(10, { leech: true })).leeched).toBe(false)
    expect(applyLeech(card(11, { leech: true }), card(12, { leech: true })).leeched).toBe(true)
    expect(applyLeech(card(15, { leech: true }), card(16, { leech: true })).leeched).toBe(true)
  })
})
