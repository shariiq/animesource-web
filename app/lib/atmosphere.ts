import { onCleanup } from 'solid-js'

const FALLBACK_COLOR = '#a5aaa5'

export function syncAtmosphereColor(color: string | null | undefined): void {
  const nextColor = color && /^#[\da-f]{6}$/i.test(color) ? color : FALLBACK_COLOR
  const background = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.app-background')
  background?.style.setProperty('--featured-color', nextColor)
  onCleanup(() => {
    if (background?.style.getPropertyValue('--featured-color') === nextColor) {
      background.style.removeProperty('--featured-color')
    }
  })
}
