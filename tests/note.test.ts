import { describe, expect, it } from 'vitest'
import { cardOrdsFor, renderCard, syncCards, validateNote, segText } from '../src/domain/note'
import type { CardRec, Note } from '../src/domain/card'
import { createScheduler, Rating } from '../src/domain/scheduler'

const NOW = new Date('2026-11-16T03:00:00Z')

function note(type: Note['type'], front: string, back = ''): Note {
  return { id: 'n1', deckId: 'd1', type, front, back, createdAt: NOW.toISOString() }
}

describe('cardOrdsFor', () => {
  it('基本は1枚、逆向きは2枚', () => {
    expect(cardOrdsFor(note('basic', 'a', 'b'))).toEqual([0])
    expect(cardOrdsFor(note('reverse', 'a', 'b'))).toEqual([0, 1])
  })
  it('穴埋めは文中の番号ごとに1枚（同じ番号が2か所でも1枚）', () => {
    expect(cardOrdsFor(note('cloze', '{{c1::東京}}は{{c2::日本}}の首都。{{c1::東京}}駅'))).toEqual([1, 2])
    expect(cardOrdsFor(note('cloze', '{{c3::a}} {{c1::b}}'))).toEqual([1, 3])
  })
})

describe('renderCard', () => {
  it('基本: 問題は表、答えは裏。答え側でも問題を表示する', () => {
    const r = renderCard(note('basic', 'apple', 'りんご'), 0)
    expect(segText(r.question)).toBe('apple')
    expect(segText(r.answer)).toBe('りんご')
    expect(r.showQuestionOnAnswer).toBe(true)
  })

  it('逆向きの2枚目は裏が問題になる', () => {
    const r = renderCard(note('reverse', 'apple', 'りんご'), 1)
    expect(segText(r.question)).toBe('りんご')
    expect(segText(r.answer)).toBe('apple')
  })

  it('穴埋め: 問題では対象の穴だけ [...] になり、ほかの穴は答えが見える', () => {
    const n = note('cloze', '{{c1::東京}}は{{c2::日本}}の首都', '補足')
    const q1 = renderCard(n, 1)
    expect(segText(q1.question)).toBe('[...]は日本の首都')
    expect(q1.question.find((s) => s.kind === 'blank')).toBeTruthy()
    expect(segText(q1.answer)).toBe('東京は日本の首都\n補足')
    expect(q1.answer.filter((s) => s.kind === 'answer').map((s) => s.text)).toEqual(['東京'])
    expect(q1.showQuestionOnAnswer).toBe(false)
    expect(segText(renderCard(n, 2).question)).toBe('東京は[...]の首都')
  })

  it('穴埋めのヒントは [ヒント] として出る', () => {
    expect(segText(renderCard(note('cloze', '{{c1::Paris::都市}}はフランスの首都'), 1).question)).toBe('[都市]はフランスの首都')
  })

  it('同じ番号の穴が2か所あれば両方隠す', () => {
    expect(segText(renderCard(note('cloze', '{{c1::A}}と{{c1::B}}'), 1).question)).toBe('[...]と[...]')
  })
})

describe('validateNote', () => {
  it('表が空・穴が無い・閉じ忘れはエラー', () => {
    expect(validateNote(note('basic', ' ', 'x'))).toMatch(/表/)
    expect(validateNote(note('cloze', '穴がない文'))).toMatch(/{{c1::/)
    expect(validateNote(note('cloze', '{{c1::閉じ忘れ'))).toMatch(/閉じ/)
    expect(validateNote(note('cloze', '{{c1::ok}}'))).toBeNull()
    expect(validateNote(note('basic', 'a', 'b'))).toBeNull()
  })
})

describe('syncCards', () => {
  it('新しいノートには型に応じた枚数のカードを作る', async () => {
    const s = await createScheduler()
    const cards = syncCards(note('reverse', 'a', 'b'), [], s, NOW)
    expect(cards.map((c) => c.ord)).toEqual([0, 1])
    expect(cards.every((c) => c.noteId === 'n1' && c.deckId === 'd1' && c.sched.reps === 0)).toBe(true)
  })

  it('編集で穴が増減しても、残るカードの出題予定は保ち、消えた穴のカードは消す', async () => {
    const s = await createScheduler()
    const n = note('cloze', '{{c1::a}} {{c2::b}}')
    const [c1, c2] = syncCards(n, [], s, NOW)
    const learned: CardRec = { ...c1, sched: s.review(c1.sched, Rating.Easy, NOW).sched }
    const edited = { ...n, front: '{{c1::a}} {{c3::c}}', deckId: 'd2' }
    const after = syncCards(edited, [learned, c2], s, NOW)
    expect(after.map((c) => c.ord)).toEqual([1, 3])
    expect(after[0].id).toBe(c1.id)
    expect(after[0].sched).toEqual(learned.sched)
    expect(after.every((c) => c.deckId === 'd2')).toBe(true)
  })
})
