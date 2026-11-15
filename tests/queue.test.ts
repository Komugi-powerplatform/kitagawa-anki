import { describe, expect, it } from 'vitest'
import { buildQueue, countsForDeck, dayStart } from '../src/domain/queue'
import type { CardRec, LogRec } from '../src/domain/card'

// 2026-11-15 12:00 JST
const NOW = new Date('2026-11-15T03:00:00Z')

function card(id: string, opts: Partial<{ deckId: string; dueAt: string; reps: number; state: number }> = {}): CardRec {
  return {
    id,
    deckId: opts.deckId ?? 'd1',
    front: id,
    back: id,
    createdAt: '2026-11-01T00:00:00Z',
    sched: {
      dueAt: opts.dueAt ?? '2026-11-15T00:00:00Z',
      lastReviewAt: null,
      reps: opts.reps ?? 0,
      lapses: 0,
      state: opts.state ?? 0,
    },
  }
}

function newLog(cardId: string, at: string): LogRec {
  return { cardId, at, rating: 3, wasNew: true }
}

describe('dayStart', () => {
  it('1日の区切りは朝4時（Ankiと同じ）', () => {
    const at3am = new Date(2026, 10, 15, 3, 0)
    const at5am = new Date(2026, 10, 15, 5, 0)
    expect(dayStart(at3am).getDate()).toBe(14)
    expect(dayStart(at5am).getDate()).toBe(15)
    expect(dayStart(at5am).getHours()).toBe(4)
  })
})

describe('buildQueue', () => {
  it('期限が来た復習カードを期限の古い順に出し、その後に新規カードを出す', () => {
    const cards = [
      card('new1'),
      card('rev-late', { reps: 3, state: 2, dueAt: '2026-11-15T02:00:00Z' }),
      card('rev-early', { reps: 3, state: 2, dueAt: '2026-11-14T00:00:00Z' }),
      card('rev-future', { reps: 3, state: 2, dueAt: '2026-11-20T00:00:00Z' }),
    ]
    const q = buildQueue(cards, [], NOW, { newPerDay: 20 })
    expect(q.map((c) => c.id)).toEqual(['rev-early', 'rev-late', 'new1'])
  })

  it('新規カードは1日の上限まで。今日すでに覚え始めた枚数を差し引く', () => {
    const cards = ['a', 'b', 'c', 'd'].map((id) => card(id))
    const logs = [newLog('x', '2026-11-15T00:00:00Z'), newLog('y', '2026-11-13T00:00:00Z')]
    const q = buildQueue(cards, logs, NOW, { newPerDay: 3 })
    expect(q.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('デッキを指定するとそのデッキだけ出す', () => {
    const cards = [card('a', { deckId: 'd1' }), card('b', { deckId: 'd2' })]
    expect(buildQueue(cards, [], NOW, { newPerDay: 20, deckId: 'd2' }).map((c) => c.id)).toEqual(['b'])
  })
})

describe('countsForDeck', () => {
  it('新規・学習中・復習の残り枚数を数える', () => {
    const cards = [
      card('n1'),
      card('n2'),
      card('learn', { reps: 1, state: 1, dueAt: '2026-11-15T02:59:00Z' }),
      card('rev', { reps: 4, state: 2, dueAt: '2026-11-15T01:00:00Z' }),
      card('later', { reps: 4, state: 2, dueAt: '2026-12-01T00:00:00Z' }),
    ]
    expect(countsForDeck(cards, [], NOW, { newPerDay: 1 })).toEqual({ new: 1, learning: 1, review: 1, total: 5 })
  })
})
