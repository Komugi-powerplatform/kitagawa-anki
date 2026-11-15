import { newId, type AppData, type CardRec } from '../domain/card'
import { buildQueue, countsForDeck, nextLearningDue } from '../domain/queue'
import { formatInterval, GRADES, Rating, type Grade, type Scheduler } from '../domain/scheduler'
import { exportJson, importJson, removeCard } from '../storage/backup'
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
  /** 答えを表示しているカードの ID。カードが変わったら自動で問題側に戻るよう、真偽値でなく ID で持つ */
  private revealedId: string | null = null
  /** 取り消し用。答える前のカードと、その時点の回答記録の件数 */
  private undoStack: { card: CardRec; logsLen: number }[] = []
  /** 取り消した直後は、そのカードをもう一度出す */
  private forcedCardId: string | null = null
  /** バックアップで置き換える前の確認待ち */
  private pendingReplace: AppData | null = null
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
    this.revealedId = null
    this.pendingReplace = null
    this.render()
    window.scrollTo(0, 0)
  }

  /** 保存できたときだけ画面のデータを差し替える。容量オーバーなどで失敗したら知らせて、元のままにする */
  private commit(data: AppData): boolean {
    try {
      this.repo.save(data)
    } catch (e) {
      this.say(`保存できませんでした（${e instanceof Error ? e.name : '不明なエラー'}）。設定からバックアップを書き出してください。`, 'error')
      return false
    }
    this.data = data
    return true
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
    if (this.forcedCardId) {
      const forced = this.data.cards.find((c) => c.id === this.forcedCardId && (!deckId || c.deckId === deckId))
      if (forced) return forced
    }
    const q = buildQueue(this.data.cards, this.data.logs, now, opts)
    if (q.length) return q[0]
    const ahead = buildQueue(this.data.cards, this.data.logs, new Date(now.getTime() + LEARN_AHEAD_MS), { ...opts, newPerDay: 0 })
    return ahead[0] ?? null
  }

  private review(deckId?: string): HTMLElement {
    const deckName = deckId ? this.data.decks.find((d) => d.id === deckId)?.name : 'すべてのデッキ'
    const card = this.currentCard(deckId)
    const header = h('header', { class: 'review-head' }, h('button', { class: 'back', onclick: () => this.go({ name: 'home' }) }, '‹ 戻る'), h('span', {}, deckName ?? ''), this.undoStack.length > 0 && h('button', { class: 'undo', onclick: () => this.undo() }, '↶ 取り消す'), this.counts(countsForDeck(this.data.cards, this.data.logs, this.now(), { newPerDay: this.settings.newPerDay, deckId })))

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
    const revealed = this.revealedId === card.id
    const reveal = () => {
      this.revealedId = card.id
      this.render()
    }
    const face = h('div', { class: 'card-face', onclick: revealed ? undefined : reveal }, h('div', { class: 'front' }, card.front), revealed && h('hr', {}), revealed && h('div', { class: 'back-text' }, card.back))
    const actions = revealed
      ? h(
          'div',
          { class: 'grades' },
          ...this.scheduler.preview(card.sched, now).map((p) =>
            h('button', { class: `grade grade-${p.rating}`, onclick: () => this.answer(card, p.rating) }, h('span', { class: 'grade-time' }, formatInterval(p.dueAt.getTime() - now.getTime())), h('span', { class: 'grade-label' }, GRADE_LABEL[p.rating])),
          ),
        )
      : h('div', { class: 'grades' }, h('button', { class: 'primary big reveal', onclick: reveal }, '答えを見る'))
    return h('section', {}, header, face, actions)
  }

  private answer(card: CardRec, rating: Grade): void {
    if (!GRADES.includes(rating)) return
    const r = this.scheduler.review(card.sched, rating, this.now())
    const saved = this.commit({
      ...this.data,
      cards: this.data.cards.map((c) => (c.id === card.id ? { ...c, sched: r.sched } : c)),
      logs: [...this.data.logs, { cardId: card.id, ...r.log }],
    })
    if (saved) {
      this.undoStack = [...this.undoStack.slice(-49), { card, logsLen: this.data.logs.length - 1 }]
      this.forcedCardId = null
      this.revealedId = null
    }
    this.render()
  }

  private undo(): void {
    const last = this.undoStack.at(-1)
    if (!last) return
    if (!this.data.cards.some((c) => c.id === last.card.id)) {
      this.undoStack = this.undoStack.slice(0, -1)
      this.render()
      return
    }
    const saved = this.commit({
      ...this.data,
      cards: this.data.cards.map((c) => (c.id === last.card.id ? last.card : c)),
      logs: this.data.logs.slice(0, last.logsLen),
    })
    if (saved) {
      this.undoStack = this.undoStack.slice(0, -1)
      this.forcedCardId = last.card.id
      this.revealedId = null
      this.say(`「${last.card.front}」の答えを取り消しました。`)
    }
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
      if (this.commit(removeCard(this.data, card.id))) this.say('カードを削除しました。')
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
    if (!this.commit({ ...this.data, decks: decks.filter((d) => used.has(d.id)), cards })) {
      this.render()
      return
    }
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
      file.value = ''
      if (!r.ok) {
        this.say(r.error, 'error')
      } else if (r.kind === 'replace') {
        this.pendingReplace = r.data
      } else if (this.commit(r.data)) {
        this.say(r.added === 0 ? '新しいカードはありませんでした（すべて取り込み済みです）。' : `${r.added}枚を取り込みました。`)
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
      this.pendingReplace && this.replaceConfirm(this.pendingReplace),
      h('div', { class: 'panel' }, h('h2', {}, '取り込み'), h('p', { class: 'hint' }, 'Anki から書き出したカード（.json）か、このアプリのバックアップを選びます。バックアップを選ぶと、今のデータは置き換わります。'), h('label', { class: 'primary file-label' }, 'ファイルを選ぶ', file)),
      h('div', { class: 'panel' }, h('h2', {}, 'バックアップ'), h('p', { class: 'hint' }, '復習の記録ごと .json に書き出します。機種変更やデータが消えたときに使います。'), h('button', { class: 'primary', onclick: () => this.exportBackup() }, '書き出す')),
      h('div', { class: 'panel' }, h('h2', {}, '学習'), h('label', {}, '1日の新規カード（枚）', newPerDay)),
      h('p', { class: 'credit' }, `出題の計算: ts-fsrs（FSRS-6, MIT License）／ データはこの端末の中だけに保存されます。カード ${this.data.cards.length}枚・復習記録 ${this.data.logs.length}件`),
    )
  }

  private replaceConfirm(next: AppData): HTMLElement {
    return h(
      'div',
      { class: 'panel confirm', role: 'alertdialog' },
      h('h2', {}, 'バックアップで置き換えますか？'),
      h('p', {}, `今のデータ（カード ${this.data.cards.length}枚・復習記録 ${this.data.logs.length}件）は消え、バックアップの内容（カード ${next.cards.length}枚・復習記録 ${next.logs.length}件）に置き換わります。`),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'danger', onclick: () => {
          this.pendingReplace = null
          if (this.commit(next)) {
            this.undoStack = []
            this.say(`バックアップから復元しました（カード ${next.cards.length}枚）。`)
          }
          this.render()
        } }, '置き換える'),
        h('button', { class: 'ghost', onclick: () => ((this.pendingReplace = null), this.render()) }, 'やめる'),
      ),
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
