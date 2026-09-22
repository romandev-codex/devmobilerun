/**
 * The indexed element tree the agent sees each step (`ui_state` events). The
 * text form mirrors the framework's indexed formatter so a log reader sees the
 * same "3. FrameLayout: "Login" - (0,900,1080,1200)" lines the model was given.
 */
export type UiElement = {
  index?: number | string
  className?: string
  resourceId?: string
  text?: string
  bounds?: string
  displayBounds?: string
  checkedState?: string
  children?: UiElement[]
}

export function asElements(value: unknown): UiElement[] {
  return Array.isArray(value) ? (value as UiElement[]) : []
}

export function countElements(elements: UiElement[]): number {
  let n = 0
  for (const el of elements) {
    if (!el || typeof el !== "object") continue
    n += 1 + countElements(el.children ?? [])
  }
  return n
}

export function formatElements(elements: UiElement[], level = 0): string[] {
  const lines: string[] = []
  const indent = "  ".repeat(level)
  for (const el of elements) {
    if (!el || typeof el !== "object") continue
    const parts: string[] = []
    if (el.index !== undefined && el.index !== "") parts.push(`${el.index}.`)
    if (el.className) parts.push(`${el.className}:`)
    const details: string[] = []
    if (el.resourceId) details.push(`"${el.resourceId}"`)
    if (el.text) details.push(`"${el.text}"`)
    if (details.length) parts.push(details.join(", "))
    if (el.checkedState) parts.push(`; ${el.checkedState}`)
    const bounds = el.displayBounds || el.bounds
    if (bounds) parts.push(`- (${bounds})`)
    lines.push(`${indent}${parts.join(" ")}`)
    if (el.children?.length)
      lines.push(...formatElements(el.children, level + 1))
  }
  return lines
}
