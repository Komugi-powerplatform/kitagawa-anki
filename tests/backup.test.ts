import { describe, expect, it } from 'vitest'
import { emptyData, exportJson, importJson } from '../src/storage/backup'
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

describe('importJson（Ankiから書き出したカード）', () => {
  it('デッキを作り、カードを新規として追加する', async () => {
    const s = await createScheduler()
    const r = importJson(seed, emptyData(), s, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.added).toBe(3)
    expect(r.data.decks.map((d) => d.name).sort()).toEqual(['English', 'デフォルト'])
    expect(r.data.cards.every((c) => c.sched.reps === 0)).toBe(true)
  })

  it('同じカードを2回取り込んでも重複しない', async () => {
    const s = await createScheduler()
    const first = importJson(seed, emptyData(), s, NOW)
    if (!first.ok) throw new Error(first.error)
    const second = importJson(seed, first.data, s, NOW)
    if (!second.ok) throw new Error(second.error)
    expect(second.added).toBe(0)
    expect(second.data.cards).toHaveLength(3)
  })
})

describe('importJson（バックアップの復元）', () => {
  it('書き出したバックアップを取り込むと、復習記録ごと元に戻る', async () => {
    const s = await createScheduler()
    const r = importJson(seed, emptyData(), s, NOW)
    if (!r.ok) throw new Error(r.error)
    const withLog = { ...r.data, logs: [{ cardId: r.data.cards[0].id, at: NOW.toISOString(), rating: 3, wasNew: true }] }
    const restored = importJson(exportJson(withLog), emptyData(), s, NOW)
    if (!restored.ok) throw new Error(restored.error)
    expect(restored.data).toEqual(withLog)
  })
})

describe('importJson（壊れたファイル）', () => {
  it.each([
    ['JSONでない', 'not json'],
    ['形式が分からない', '{"foo":1}'],
    ['カードの表が空', '{"format":"kitagawa-anki-seed","cards":[{"deck":"a","front":"","back":"x"}]}'],
  ])('%s → エラーを返し、データは変えない', async (_name, text) => {
    const s = await createScheduler()
    const r = importJson(text, emptyData(), s, NOW)
    expect(r.ok).toBe(false)
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
