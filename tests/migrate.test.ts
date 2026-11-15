import { describe, expect, it } from 'vitest'
import { migrate } from '../src/storage/migrate'

// 第1弾（version 1）で実際に保存していた形
const v1 = {
  version: 1,
  decks: [{ id: 'd1', name: 'English' }],
  cards: [
    {
      id: 'c1',
      deckId: 'd1',
      front: 'tiredness',
      back: '疲労',
      createdAt: '2026-11-15T12:00:00.000Z',
      sched: { dueAt: '2026-11-22T12:00:00.000Z', lastReviewAt: '2026-11-15T12:00:00.000Z', reps: 1, lapses: 0, state: 2, stability: 7.1, difficulty: 3.2 },
    },
  ],
  logs: [{ cardId: 'c1', at: '2026-11-15T12:00:00.000Z', rating: 4, wasNew: true }],
}

describe('migrate', () => {
  it('version 1 を version 2 にする。カードID・出題予定・回答記録はそのまま', () => {
    const r = migrate(structuredClone(v1))
    if (!r) throw new Error('migrate failed')
    expect(r.version).toBe(2)
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toMatchObject({ type: 'basic', front: 'tiredness', back: '疲労', deckId: 'd1', createdAt: v1.cards[0].createdAt })
    expect(r.cards[0]).toEqual({ id: 'c1', noteId: r.notes[0].id, deckId: 'd1', ord: 0, createdAt: v1.cards[0].createdAt, sched: v1.cards[0].sched })
    expect(r.logs).toEqual(v1.logs)
    expect(r.decks).toEqual(v1.decks)
  })

  it('version 2 はそのまま返す', () => {
    const v2 = migrate(structuredClone(v1))!
    expect(migrate(structuredClone(v2))).toEqual(v2)
  })

  it('形が分からないものは null', () => {
    expect(migrate({ version: 3 })).toBeNull()
    expect(migrate({ foo: 1 })).toBeNull()
    expect(migrate(null)).toBeNull()
  })
})
