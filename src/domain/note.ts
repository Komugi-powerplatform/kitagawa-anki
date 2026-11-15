import { newId, type CardRec, type Note } from './card'
import type { Scheduler } from './scheduler'

/** 表示用の文のかけら。blank=隠した穴、answer=答え側で強調する穴 */
export interface Seg {
  text: string
  kind: 'plain' | 'blank' | 'answer'
}

export interface Rendered {
  question: Seg[]
  answer: Seg[]
  /** 答え側でも問題を上に出すか（基本・逆向き=出す、穴埋め=答えの文だけ出す） */
  showQuestionOnAnswer: boolean
}

// Anki と同じ書き方: {{c1::答え}} / {{c1::答え::ヒント}}
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g

export function segText(segs: Seg[]): string {
  return segs.map((s) => s.text).join('')
}

function clozeNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(CLOZE)].map((m) => Number(m[1])))].filter((n) => n > 0).sort((a, b) => a - b)
}

export function cardOrdsFor(note: Note): number[] {
  if (note.type === 'basic') return [0]
  if (note.type === 'reverse') return [0, 1]
  return clozeNumbers(note.front)
}

/** 保存できないノートなら理由を返す */
export function validateNote(note: Note): string | null {
  if (!note.front.trim()) return note.type === 'cloze' ? '文を入れてください。' : '表を入れてください。'
  if (note.type === 'reverse' && !note.back.trim()) return '逆向きのカードを作るには裏も入れてください。'
  if (note.type === 'cloze') {
    if (note.front.replace(CLOZE, '').includes('{{c')) return '{{c1::…}} の閉じ忘れがあります（最後に }} が必要です）。'
    if (clozeNumbers(note.front).length === 0) return '穴にしたい所を {{c1::答え}} の形で囲んでください。'
  }
  return null
}

function clozeSegs(text: string, ord: number, side: 'question' | 'answer'): Seg[] {
  const segs: Seg[] = []
  let last = 0
  for (const m of text.matchAll(CLOZE)) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), kind: 'plain' })
    const [, num, answer, hint] = m
    if (Number(num) !== ord) segs.push({ text: answer, kind: 'plain' })
    else if (side === 'question') segs.push({ text: `[${hint ?? '...'}]`, kind: 'blank' })
    else segs.push({ text: answer, kind: 'answer' })
    last = m.index + m[0].length
  }
  if (last < text.length) segs.push({ text: text.slice(last), kind: 'plain' })
  return segs
}

export function renderCard(note: Note, ord: number): Rendered {
  if (note.type === 'cloze') {
    const answer = clozeSegs(note.front, ord, 'answer')
    if (note.back.trim()) answer.push({ text: `\n${note.back}`, kind: 'plain' })
    return { question: clozeSegs(note.front, ord, 'question'), answer, showQuestionOnAnswer: false }
  }
  const [q, a] = note.type === 'reverse' && ord === 1 ? [note.back, note.front] : [note.front, note.back]
  return { question: [{ text: q, kind: 'plain' }], answer: [{ text: a, kind: 'plain' }], showQuestionOnAnswer: true }
}

/**
 * ノートに合うカードの組を返す。すでにある番号のカードは出題予定を保ったまま残し（デッキはノートに合わせる）、
 * 足りない番号は新規カードを作り、要らなくなった番号のカードは外す。
 */
export function syncCards(note: Note, existing: CardRec[], scheduler: Scheduler, now: Date): CardRec[] {
  const byOrd = new Map(existing.filter((c) => c.noteId === note.id).map((c) => [c.ord, c]))
  return cardOrdsFor(note).map((ord) => {
    const kept = byOrd.get(ord)
    if (kept) return { ...kept, deckId: note.deckId }
    return { id: newId(), noteId: note.id, deckId: note.deckId, ord, createdAt: note.createdAt, sched: scheduler.newSched(now) }
  })
}
