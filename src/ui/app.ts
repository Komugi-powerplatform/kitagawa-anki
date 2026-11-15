import { newId, type AppData, type CardRec } from '../domain/card'
import { buildQueue, countsForDeck, nextLearningDue } from '../domain/queue'
import { formatInterval, GRADES, Rating, type Grade, type Scheduler } from '../domain/scheduler'
import { exportJson, importJson } from '../storage/backup'
import type { Repo } from '../storage/repo'
import { h } from './dom'

type Screen = { name: 'home' } | { name: 'review'; deckId?: string } | { name: 'cards'; editId?: string } | { name: 'settings' }

const SETTINGS_KEY = 'kitagawa-anki:settings'
/** 学習中カードは、ほかに出すものが無ければ20分先までは前倒しで出す（Anki の初期設定と同じ） */
const LEARN_AHEAD_MS = 20 * 60_000

const GRADE_LABEL: Record<Grade, string> = {
  [Rating.Again]: 'もう一度',
  [Rating.Hard]: '難しい',
  [Rating.Good]: '普通',
  [Rating.Easy]: '簡単',
}

interface Settings {
  newPerDay: number
}

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return { newPerDay: Number.isInteger(s.newPerDay) && s.newPerDay >= 0 ? s.newPerDay : 20 }
  } catch {
    return { newPerDay: 20 }
  }
}

export class App {
  private data: AppData
  private settings = loadSettings()
  private screen: Screen = { name: 'home' }
  private revealed = false
  private flash: { text: string; kind: 'ok' | 'error' } | null = null

  constructor(
    private root: HTMLElement,
    private repo: Repo,
    private scheduler: Scheduler,
    private now: () => Date = () => new Date(),
  ) {
    this.data = repo.load()
  }

  start(): void {
    this.render()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.render()
    })
  }

  private go(screen: Screen): void {
    this.screen = screen
    this.revealed = false
    this.render()
    window.scrollTo(0, 0)
  }

  private commit(data: AppData): void {
    this.data = data
    this.repo.save(data)
  }

  private say(text: string, kind: 'ok' | 'error' = 'ok'): void {
    this.flash = { text, kind }
  }

  render(): void {
    const body =
      this.screen.name === 'home'
        ? this.home()
        : this.screen.name === 'review'
          ? this.review(this.screen.deckId)
          : this.screen.name === 'cards'
            ? this.cards(this.screen.editId)
            : this.settingsScreen()
    const flash = this.flash
    this.flash = null
    this.root.replaceChildren(
      h('main', { class: `screen screen-${this.screen.name}` }, flash && h('p', { class: `flash flash-${flash.kind}`, role: 'status' }, flash.text), body),
      this.nav(),
    )
  }

  private nav(): HTMLElement {
    const item = (name: Screen['name'], label: string) =>
      h('button', { class: `nav-item${this.screen.name === name ? ' active' : ''}`, onclick: () => this.go({ name } as Screen) }, label)
    return h('nav', { class: 'nav' }, item('home', 'ホーム'), item('cards', 'カード'), item('settings', '設定'))
  }

  // ---------- ホーム ----------
  private home(): HTMLElement {
    const now = this.now()
    const opts = { newPerDay: this.settings.newPerDay }
    if (this.data.cards.length === 0) {
      return h(
        'section',
        {},
        h('h1', {}, 'KitagawaAnki'),
        h('div', { class: 'empty' }, h('p', {}, 'カードがまだありません。'), h('button', { class: 'primary', onclick: () => this.go({ name: 'settings' }) }, 'ファイルから取り込む'), h('button', { class: 'ghost', onclick: () => this.go({ name: 'cards' }) }, '自分で追加する')),
      )
    }
    const all = countsForDeck(this.data.cards, this.data.logs, now, opts)
    const rows = [...this.data.decks]
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      .map((d) => {
        const c = countsForDeck(this.data.cards, this.data.logs, now, { ...opts, deckId: d.id })
        return h(
          'button',
          { class: 'deck', onclick: () => this.go({ name: 'review', deckId: d.id }) },
          h('span', { class: 'deck-name' }, d.name),
          h('span', { class: 'deck-total' }, `${c.total}枚`),
          this.counts(c),
        )
      })
    const remaining = all.new + all.learning + all.review
    return h(
      'section',
      {},
      h('h1', {}, 'KitagawaAnki'),
      h('div', { class: 'today' }, h('p', { class: 'today-label' }, '今日の残り'), this.counts(all), h('p', { class: 'hint legend' }, h('span', { class: 'n-new' }, '新規'), ' ・ ', h('span', { class: 'n-learn' }, '学習中'), ' ・ ', h('span', { class: 'n-review' }, '復習')), h('button', { class: 'primary big', disabled: remaining === 0, onclick: () => this.go({ name: 'review' }) }, remaining === 0 ? '今日の分は終わりました' : 'すべてのデッキを学習する')),
      h('h2', {}, 'デッキ'),
      h('div', { class: 'decks' }, ...rows),
    )
  }

  private counts(c: { new: number; learning: number; review: number }): HTMLElement {
    return h('span', { class: 'counts' }, h('span', { class: 'n-new', title: '新規' }, String(c.new)), h('span', { class: 'n-learn', title: '学習中' }, String(c.learning)), h('span', { class: 'n-review', title: '復習' }, String(c.review)))
  }

  // ---------- 復習 ----------
  private currentCard(deckId?: string): CardRec | null {
    const now = this.now()
    const opts = { newPerDay: this.settings.newPerDay, deckId }
    const q = buildQueue(this.data.cards, this.data.logs, now, opts)
    if (q.length) return q[0]
    const ahead = buildQueue(this.data.cards, this.data.logs, new Date(now.getTime() + LEARN_AHEAD_MS), { ...opts, newPerDay: 0 })
    return ahead[0] ?? null
  }

  private review(deckId?: string): HTMLElement {
    const deckName = deckId ? this.data.decks.find((d) => d.id === deckId)?.name : 'すべてのデッキ'
    const card = this.currentCard(deckId)
    const header = h('header', { class: 'review-head' }, h('button', { class: 'back', onclick: () => this.go({ name: 'home' }) }, '‹ 戻る'), h('span', {}, deckName ?? ''), this.counts(countsForDeck(this.data.cards, this.data.logs, this.now(), { newPerDay: this.settings.newPerDay, deckId })))

    if (!card) {
      const next = nextLearningDue(this.data.cards, this.now(), deckId)
      return h(
        'section',
        {},
        header,
        h('div', { class: 'done' }, h('p', { class: 'done-title' }, 'おつかれさまでした'), h('p', {}, next ? `次のカードは ${next.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} ごろに出せます。` : '今日のカードはすべて終わりました。'), h('button', { class: 'primary', onclick: () => this.go({ name: 'home' }) }, 'ホームへ')),
      )
    }

    const now = this.now()
    const face = h('div', { class: 'card-face' }, h('div', { class: 'front' }, card.front), this.revealed && h('hr', {}), this.revealed && h('div', { class: 'back-text' }, card.back))
    const actions = this.revealed
      ? h(
          'div',
          { class: 'grades' },
          ...this.scheduler.preview(card.sched, now).map((p) =>
            h('button', { class: `grade grade-${p.rating}`, onclick: () => this.answer(card, p.rating) }, h('span', { class: 'grade-time' }, formatInterval(p.dueAt.getTime() - now.getTime())), h('span', { class: 'grade-label' }, GRADE_LABEL[p.rating])),
          ),
        )
      : h('div', { class: 'grades' }, h('button', { class: 'primary big reveal', onclick: () => ((this.revealed = true), this.render()) }, '答えを見る'))
    return h('section', {}, header, face, actions)
  }

  private answer(card: CardRec, rating: Grade): void {
    if (!GRADES.includes(rating)) return
    const r = this.scheduler.review(card.sched, rating, this.now())
    this.commit({
      ...this.data,
      cards: this.data.cards.map((c) => (c.id === card.id ? { ...c, sched: r.sched } : c)),
      logs: [...this.data.logs, { cardId: card.id, ...r.log }],
    })
    this.revealed = false
    this.render()
  }

  // ---------- カード管理 ----------
  private cards(editId?: string): HTMLElement {
    const editing = editId ? this.data.cards.find((c) => c.id === editId) : undefined
    const deckNames = [...this.data.decks].sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    const lastDeck = localStorage.getItem('kitagawa-anki:lastDeck') ?? deckNames[0]?.name ?? 'デフォルト'
    const deckInput = h('input', { name: 'deck', list: 'deck-list', value: editing ? (this.data.decks.find((d) => d.id === editing.deckId)?.name ?? '') : lastDeck, required: true, autocomplete: 'off' })
    const front = h('textarea', { name: 'front', rows: 2, required: true, value: editing?.front ?? '' })
    const back = h('textarea', { name: 'back', rows: 3, value: editing?.back ?? '' })

    const form = h(
      'form',
      {
        class: 'card-form',
        onsubmit: (e: Event) => {
          e.preventDefault()
          this.saveCard(editing, deckInput.value.trim(), front.value.trim(), back.value.trim())
        },
      },
      h('h2', {}, editing ? 'カードを編集' : 'カードを追加'),
      h('label', {}, 'デッキ', deckInput),
      h('datalist', { id: 'deck-list' }, ...deckNames.map((d) => h('option', { value: d.name }))),
      h('label', {}, '表', front),
      h('label', {}, '裏', back),
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, editing ? '保存' : '追加'), editing && h('button', { class: 'ghost', type: 'button', onclick: () => this.go({ name: 'cards' }) }, 'やめる'), editing && this.deleteButton(editing)),
    )

    const list = h(
      'ul',
      { class: 'card-list' },
      ...[...this.data.cards]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((c) =>
          h('li', {}, h('button', { class: 'card-row', onclick: () => this.go({ name: 'cards', editId: c.id }) }, h('span', { class: 'cr-front' }, c.front), h('span', { class: 'cr-back' }, c.back), h('span', { class: 'cr-meta' }, `${this.data.decks.find((d) => d.id === c.deckId)?.name ?? ''} ・ ${c.sched.reps === 0 ? '新規' : `次回 ${new Date(c.sched.dueAt).toLocaleDateString('ja-JP')}`}`))),
        ),
    )
    return h('section', {}, form, h('h2', {}, `カード一覧（${this.data.cards.length}枚）`), list)
  }

  private deleteButton(card: CardRec): HTMLElement {
    const btn = h('button', { class: 'danger', type: 'button' }, '削除')
    btn.addEventListener('click', () => {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1'
        btn.textContent = 'もう一度押すと削除'
        return
      }
      this.commit({ ...this.data, cards: this.data.cards.filter((c) => c.id !== card.id), logs: this.data.logs.filter((l) => l.cardId !== card.id) })
      this.say('カードを削除しました。')
      this.go({ name: 'cards' })
    })
    return btn
  }

  private saveCard(editing: CardRec | undefined, deckName: string, front: string, back: string): void {
    if (!deckName || !front) {
      this.say('デッキと表は必ず入れてください。', 'error')
      this.render()
      return
    }
    const decks = [...this.data.decks]
    let deck = decks.find((d) => d.name === deckName)
    if (!deck) {
      deck = { id: newId(), name: deckName }
      decks.push(deck)
    }
    localStorage.setItem('kitagawa-anki:lastDeck', deckName)
    const now = this.now()
    const cards = editing
      ? this.data.cards.map((c) => (c.id === editing.id ? { ...c, deckId: deck.id, front, back } : c))
      : [...this.data.cards, { id: newId(), deckId: deck.id, front, back, createdAt: now.toISOString(), sched: this.scheduler.newSched(now) }]
    const used = new Set(cards.map((c) => c.deckId))
    this.commit({ ...this.data, decks: decks.filter((d) => used.has(d.id)), cards })
    this.say(editing ? '保存しました。' : `「${front}」を追加しました。`)
    this.go({ name: 'cards' })
  }

  // ---------- 設定 ----------
  private settingsScreen(): HTMLElement {
    const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'file' })
    file.addEventListener('change', async () => {
      const f = file.files?.[0]
      if (!f) return
      const r = importJson(await f.text(), this.data, this.scheduler, this.now())
      if (!r.ok) {
        this.say(r.error, 'error')
      } else {
        this.commit(r.data)
        this.say(`${r.added}枚を取り込みました。`)
      }
      this.render()
    })

    const newPerDay = h('input', { type: 'number', min: 0, max: 999, inputmode: 'numeric', value: String(this.settings.newPerDay) })
    newPerDay.addEventListener('change', () => {
      const n = Math.max(0, Math.min(999, Math.floor(Number(newPerDay.value) || 0)))
      this.settings = { ...this.settings, newPerDay: n }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
      this.say(`1日の新規カードを${n}枚にしました。`)
      this.render()
    })

    return h(
      'section',
      {},
      h('h1', {}, '設定'),
      h('div', { class: 'panel' }, h('h2', {}, '取り込み'), h('p', { class: 'hint' }, 'Anki から書き出したカード（.json）か、このアプリのバックアップを選びます。バックアップを選ぶと、今のデータは置き換わります。'), h('label', { class: 'primary file-label' }, 'ファイルを選ぶ', file)),
      h('div', { class: 'panel' }, h('h2', {}, 'バックアップ'), h('p', { class: 'hint' }, '復習の記録ごと .json に書き出します。機種変更やデータが消えたときに使います。'), h('button', { class: 'primary', onclick: () => this.exportBackup() }, '書き出す')),
      h('div', { class: 'panel' }, h('h2', {}, '学習'), h('label', {}, '1日の新規カード（枚）', newPerDay)),
      h('p', { class: 'credit' }, `出題の計算: ts-fsrs（FSRS-6, MIT License）／ データはこの端末の中だけに保存されます。カード ${this.data.cards.length}枚・復習記録 ${this.data.logs.length}件`),
    )
  }

  private async exportBackup(): Promise<void> {
    const name = `kitagawa-anki-backup-${this.now().toISOString().slice(0, 10)}.json`
    const file = new File([exportJson(this.data)], name, { type: 'application/json' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    const a = h('a', { href: URL.createObjectURL(file), download: name })
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }
}
