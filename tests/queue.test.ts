import { describe, expect, it } from 'vitest'
import { buildQueue, countsForDeck, dayStart } from '../src/domain/queue'
import type { AppData, CardRec, Deck, LogRec } from '../src/domain/card'

// 2026-11-15 12:00 JST
const NOW = new Date('2026-11-15T03:00:00Z')
const DEFAULTS = { newPerDay: 20, reviewPerDay: 200 }

function card(id: string, opts: Partial<{ deckId: string; dueAt: string; reps: number; state: number; buried: string; suspended: boolean; createdAt: string }> = {}): CardRec {
  return {
    id,
    noteId: 'n-' + id,
    deckId: opts.deckId ?? 'd1',
    ord: 0,
    createdAt: opts.createdAt ?? '2026-11-01T00:00:00Z',
    sched: { dueAt: opts.dueAt ?? '2026-11-15T00:00:00Z', lastReviewAt: null, reps: opts.reps ?? 0, lapses: 0, state: opts.state ?? 0 },
    ...(opts.buried ? { buried: opts.buried } : {}),
    ...(opts.suspended ? { suspended: true } : {}),
  }
}

function data(cards: CardRec[], logs: LogRec[] = [], decks: Deck[] = [{ id: 'd1', name: 'A' }, { id: 'd2', name: 'B' }]): AppData {
  return { version: 2, decks, notes: [], cards, logs }
}

const rev = (id: string, dueAt = '2026-11-14T00:00:00Z', deckId = 'd1') => card(id, { reps: 3, state: 2, dueAt, deckId })
const newLog = (cardId: string, at: string, deckId = 'd1'): LogRec => ({ cardId, deckId, at, rating: 3, wasNew: true, prevState: 0 })
const revLog = (cardId: string, at: string, deckId = 'd1'): LogRec => ({ cardId, deckId, at, rating: 3, wasNew: false, prevState: 2 })
const ids = (q: CardRec[]) => q.map((c) => c.id)

describe('dayStart', () => {
  it('1日の区切りは朝4時（Ankiと同じ）', () => {
    expect(dayStart(new Date(2026, 10, 15, 3, 0)).getDate()).toBe(14)
    expect(dayStart(new Date(2026, 10, 15, 5, 0)).getDate()).toBe(15)
    expect(dayStart(new Date(2026, 10, 15, 5, 0)).getHours()).toBe(4)
  })
})

describe('buildQueue', () => {
  it('期限が来た復習カードを期限の古い順に出し、その後に新規カードを出す', () => {
    const cards = [card('new1'), rev('rev-late', '2026-11-15T02:00:00Z'), rev('rev-early', '2026-11-14T00:00:00Z'), rev('rev-future', '2026-11-20T00:00:00Z')]
    expect(ids(buildQueue(data(cards), NOW, { defaults: DEFAULTS }))).toEqual(['rev-early', 'rev-late', 'new1'])
  })

  it('新規カードは1日の上限まで。今日すでに覚え始めた枚数を差し引く', () => {
    const cards = ['a', 'b', 'c', 'd'].map((id) => card(id))
    const logs = [newLog('x', '2026-11-15T00:00:00Z'), newLog('y', '2026-11-13T00:00:00Z')]
    expect(ids(buildQueue(data(cards, logs), NOW, { defaults: { ...DEFAULTS, newPerDay: 3 } }))).toEqual(['a', 'b'])
  })

  it('デッキを指定するとそのデッキだけ出す', () => {
    const cards = [card('a', { deckId: 'd1' }), card('b', { deckId: 'd2' })]
    expect(ids(buildQueue(data(cards), NOW, { defaults: DEFAULTS, deckId: 'd2' }))).toEqual(['b'])
  })
})

describe('復習カードは日単位で出す（Anki と同じ）', () => {
  it('期日の日になれば、期日の時刻より前でも朝4時から出る', () => {
    const c = rev('rev', '2026-11-21T12:00:00Z') // 11-21 21:00 JST
    const morning = new Date('2026-11-20T23:00:00Z') // 11-21 08:00 JST
    expect(ids(buildQueue(data([c]), morning, { defaults: DEFAULTS }))).toEqual(['rev'])
    expect(countsForDeck(data([c]), morning, { defaults: DEFAULTS }).review).toBe(1)
  })
  it('期日の前日には出ない', () => {
    expect(buildQueue(data([rev('rev', '2026-11-21T12:00:00Z')]), new Date('2026-11-20T12:00:00Z'), { defaults: DEFAULTS })).toEqual([])
  })
  it('学習中カードは今まで通り時刻で出す', () => {
    expect(buildQueue(data([card('learn', { reps: 1, state: 1, dueAt: '2026-11-15T03:10:00Z' })]), NOW, { defaults: DEFAULTS })).toEqual([])
  })
})

describe('保留と停止', () => {
  it('保留したカードは戻る時刻（翌朝4時）まで出ない', () => {
    const c = card('b', { buried: '2026-11-15T19:00:00Z' }) // 11-16 04:00 JST
    expect(buildQueue(data([c]), NOW, { defaults: DEFAULTS })).toEqual([])
    expect(ids(buildQueue(data([c]), new Date('2026-11-15T19:00:00Z'), { defaults: DEFAULTS }))).toEqual(['b'])
  })
  it('停止したカードは出ない（新規・復習とも）', () => {
    const cards = [card('n', { suspended: true }), { ...rev('r'), suspended: true }]
    expect(buildQueue(data(cards), NOW, { defaults: DEFAULTS })).toEqual([])
    expect(countsForDeck(data(cards), NOW, { defaults: DEFAULTS })).toMatchObject({ new: 0, review: 0 })
  })
})

describe('デッキごとの1日の上限', () => {
  it('復習の上限まで出し、今日すでに復習した枚数を差し引く', () => {
    const cards = ['r1', 'r2', 'r3', 'r4'].map((id) => rev(id))
    const logs = [revLog('x', '2026-11-15T00:00:00Z')]
    const decks = [{ id: 'd1', name: 'A', reviewPerDay: 3 }]
    expect(ids(buildQueue(data(cards, logs, decks), NOW, { defaults: DEFAULTS }))).toEqual(['r1', 'r2'])
  })
  it('学習中のカードは上限に関係なく出る', () => {
    const cards = [card('l', { reps: 1, state: 1, dueAt: '2026-11-15T02:00:00Z' }), rev('r')]
    const decks = [{ id: 'd1', name: 'A', reviewPerDay: 0 }]
    expect(ids(buildQueue(data(cards, [], decks), NOW, { defaults: DEFAULTS }))).toEqual(['l'])
  })
  it('デッキの新規上限はデッキごとに効き、「すべてのデッキ」は各デッキの上限の合計', () => {
    const cards = [card('a1', { deckId: 'd1', createdAt: '2026-11-01T00:00:00Z' }), card('a2', { deckId: 'd1', createdAt: '2026-11-01T00:00:01Z' }), card('b1', { deckId: 'd2', createdAt: '2026-11-01T00:00:02Z' }), card('b2', { deckId: 'd2', createdAt: '2026-11-01T00:00:03Z' })]
    const decks = [{ id: 'd1', name: 'A', newPerDay: 1 }, { id: 'd2', name: 'B' }]
    expect(ids(buildQueue(data(cards, [], decks), NOW, { defaults: DEFAULTS, deckId: 'd1' }))).toEqual(['a1'])
    expect(ids(buildQueue(data(cards, [], decks), NOW, { defaults: DEFAULTS }))).toEqual(['a1', 'b1', 'b2'])
  })
})

describe('countsForDeck', () => {
  it('新規・学習中・復習の残り枚数を数える', () => {
    const cards = [card('n1'), card('n2'), card('learn', { reps: 1, state: 1, dueAt: '2026-11-15T02:59:00Z' }), rev('rev', '2026-11-15T01:00:00Z'), rev('later', '2026-12-01T00:00:00Z')]
    expect(countsForDeck(data(cards), NOW, { defaults: { ...DEFAULTS, newPerDay: 1 } })).toEqual({ new: 1, learning: 1, review: 1, total: 5 })
  })
})
