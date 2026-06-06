import { useEffect } from 'react'
import { useAppStore, type AccentColor, type ThemeMode } from '@/stores/app-store'

const ACCENT_H: Record<AccentColor, number> = {
  purple: 270, lime: 86, blue: 210, cyan: 186, pink: 330, yellow: 45,
}

const DARK_SL: Record<AccentColor, [string, string]> = {
  purple: ['70%', '68%'], lime: ['84%', '62%'], blue: ['80%', '62%'],
  cyan:   ['80%', '52%'], pink: ['80%', '68%'], yellow: ['92%', '56%'],
}

const LIGHT_SL: Record<AccentColor, [string, string]> = {
  purple: ['55%', '42%'], lime: ['65%', '34%'], blue: ['60%', '42%'],
  cyan:   ['60%', '34%'], pink: ['58%', '46%'], yellow: ['75%', '38%'],
}

function buildFaviconDataUri(accent: AccentColor, mode: ThemeMode): string {
  const h = ACCENT_H[accent]
  const [s, l] = mode === 'light' ? LIGHT_SL[accent] : DARK_SL[accent]
  const color = `hsl(${h},${s},${l})`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${color}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function useFaviconState() {
  const accent = useAppStore(s => s.accent)
  const mode = useAppStore(s => s.mode)

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    link.href = buildFaviconDataUri(accent, mode)
    link.type = 'image/svg+xml'
  }, [accent, mode])
}
