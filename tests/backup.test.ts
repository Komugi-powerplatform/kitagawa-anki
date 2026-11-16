import { describe, expect, it } from 'vitest'
import { emptyData, exportJson, importJson, removeDeck, removeNote } from '../src/storage/backup'
import { MemoryRepo } from '../src/storage/repo'
import { createScheduler } from '../src/domain/scheduler'

const NOW = new Date('2026-11-15T12:00:00Z')

const seed = JSON.stringify({
  format: 'kitagawa-anki-seed',
  cards: [
    { deck: 'English', front: 'tiredness', back: '疲労' },
    { deck: 'English', front: 'mice', back: 'ネズミ（複数形）' },
    { deck: 'デフォルト', front: 'groom', back: '新郎' },
  ],
})

async function seeded() {
  const s = await createScheduler()
  const r = importJson(seed, emptyData(), s, NOW)
  if (!r.ok) throw new Error(r.error)
  return { s, r }
}

describe('importJson（Ankiから書き出したカード）', () => {
  it('デッキを作り、基本ノートと新規カードを追加する', async () => {
    const { r } = await seeded()
    expect(r.added).toBe(3)
    expect(r.kind).toBe('merge')
    expect(r.data.version).toBe(2)
    expect(r.data.decks.map((d) => d.name).sort()).toEqual(['English', 'デフォルト'])
    expect(r.data.notes.every((n) => n.type === 'basic')).toBe(true)
    expect(r.data.cards.map((c) => c.noteId).sort()).toEqual(r.data.notes.map((n) => n.id).sort())
    expect(r.data.cards.every((c) => c.sched.reps === 0)).toBe(true)
  })

  it('同じカードを2回取り込んでも重複しない', async () => {
    const { s, r } = await seeded()
    const second = importJson(seed, r.data, s, NOW)
    if (!second.ok) throw new Error(second.error)
    expect(second.added).toBe(0)
    expect(second.data.notes).toHaveLength(3)
  })
})

describe('importJson（バックアップの復元）', () => {
  it('書き出したバックアップを取り込むと、復習記録ごと元に戻る', async () => {
    const { s, r } = await seeded()
    const withLog = { ...r.data, logs: [{ cardId: r.data.cards[0].id, deckId: r.data.cards[0].deckId, at: NOW.toISOString(), rating: 3, wasNew: true, prevState: 0 }] }
    const restored = importJson(exportJson(withLog), emptyData(), s, NOW)
    if (!restored.ok) throw new Error(restored.error)
    expect(restored.data).toEqual(withLog)
    expect(restored.kind).toBe('replace')
  })

  it('第1弾（version 1）のバックアップも読める', async () => {
    const s = await createScheduler()
    const v1 = { version: 1, decks: [{ id: 'd1', name: 'E' }], cards: [{ id: 'c1', deckId: 'd1', front: 'a', back: 'b', createdAt: NOW.toISOString(), sched: { dueAt: NOW.toISOString(), lastReviewAt: null, reps: 0, lapses: 0, state: 0 } }], logs: [] }
    const r = importJson(JSON.stringify(v1), emptyData(), s, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.data.version).toBe(2)
    expect(r.data.cards[0].id).toBe('c1')
  })
})

describe('importJson（壊れたファイル）', () => {
  it.each([
    ['JSONでない', 'not json'],
    ['形式が分からない', '{"foo":1}'],
    ['カードの表が空', '{"format":"kitagawa-anki-seed","cards":[{"deck":"a","front":"","back":"x"}]}'],
  ])('%s → エラーを返す', async (_name, text) => {
    const s = await createScheduler()
    expect(importJson(text, emptyData(), s, NOW).ok).toBe(false)
  })
})

describe('removeNote', () => {
  it('ノートとそのカードを消す。回答記録は残す。空になったデッキは消す', async () => {
    const { r } = await seeded()
    const groom = r.data.notes.find((n) => n.front === 'groom')!
    const groomCard = r.data.cards.find((c) => c.noteId === groom.id)!
    const data = { ...r.data, logs: [{ cardId: groomCard.id, deckId: groomCard.deckId, at: NOW.toISOString(), rating: 3, wasNew: true, prevState: 0 }] }
    const after = removeNote(data, groom.id)
    expect(after.notes).toHaveLength(2)
    expect(after.cards).toHaveLength(2)
    expect(after.logs).toHaveLength(1)
    expect(after.decks.map((d) => d.name)).toEqual(['English'])
  })
})

describe('removeDeck', () => {
  it('デッキと中のノート・カードを消す', async () => {
    const { r } = await seeded()
    const en = r.data.decks.find((d) => d.name === 'English')!
    const after = removeDeck(r.data, en.id)
    expect(after.decks.map((d) => d.name)).toEqual(['デフォルト'])
    expect(after.notes.map((n) => n.front)).toEqual(['groom'])
    expect(after.cards).toHaveLength(1)
  })
})

describe('MemoryRepo', () => {
  it('保存したデータを読み戻せる。未保存なら空のデータ', () => {
    const repo = new MemoryRepo()
    expect(repo.load()).toEqual(emptyData())
    const data = { ...emptyData(), decks: [{ id: 'd1', name: 'English' }] }
    repo.save(data)
    expect(repo.load()).toEqual(data)
  })
})

describe('removeDeck（敵対検証の指摘）', () => {
  it('デッキがずれたカードが残っていても、ノートと一緒に消す', async () => {
    const { r } = await seeded()
    const en = r.data.decks.find((d) => d.name === 'English')!
    const card = r.data.cards.find((c) => c.deckId === en.id)!
    const skewed = { ...r.data, cards: r.data.cards.map((c) => (c.id === card.id ? { ...c, deckId: 'old-deck' } : c)) }
    const after = removeDeck(skewed, en.id)
    expect(after.cards.some((c) => c.id === card.id)).toBe(false)
  })
})
