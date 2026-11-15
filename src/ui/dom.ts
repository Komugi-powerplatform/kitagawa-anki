type Child = Node | string | null | undefined | false
type Props = Record<string, unknown> & { class?: string; onclick?: (e: MouseEvent) => void }

/** 小さな DOM 組み立て関数。文字は必ず textContent として入るので、カードの中身が HTML として解釈されることはない */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = String(value)
    else if (key === 'value') (el as unknown as { value: string }).value = String(value) // textarea は属性では中身が入らない
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener)
    else if (key in el && typeof value !== 'string') (el as unknown as Record<string, unknown>)[key] = value
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}
