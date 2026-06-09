import type { AccentColor, ThemeMode } from '@/stores/app-store'

const STORAGE_KEY_MODE = 'heku:theme-mode'
const STORAGE_KEY_ACCENT = 'heku:accent'
const STORAGE_KEY_FONT_SIZE = 'heku:font-size'

export function loadTheme(): { mode: ThemeMode; accent: AccentColor; fontSize: number } {
  const mode = (localStorage.getItem(STORAGE_KEY_MODE) as ThemeMode) || 'dark'
  const accent = (localStorage.getItem(STORAGE_KEY_ACCENT) as AccentColor) || 'purple'
  const fontSize = parseInt(localStorage.getItem(STORAGE_KEY_FONT_SIZE) || '13', 10)
  return { mode, accent, fontSize }
}

export function applyTheme(mode: ThemeMode, accent: AccentColor): void {
  const html = document.documentElement
  html.setAttribute('data-mode', mode)
  html.setAttribute('data-accent', accent)
  localStorage.setItem(STORAGE_KEY_MODE, mode)
  localStorage.setItem(STORAGE_KEY_ACCENT, accent)
}

export function applyFontSize(size: number): void {
  document.documentElement.style.fontSize = `${size}px`
  localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(size))
}
