import { useEffect } from 'react'
import { useAppStore, type AccentColor, type ThemeMode } from '@/stores/app-store'

const DARK_HSL: Record<AccentColor, [number, string, string]> = {
  plasma: [255, '100%', '71%'],
  surge:  [165, '100%', '42%'],
  frost:  [193, '100%', '47%'],
  void:   [212, '100%', '50%'],
  dusk:   [31,  '100%', '58%'],
  ember:  [331, '93%',  '63%'],
}

const LIGHT_HSL: Record<AccentColor, [number, string, string]> = {
  plasma: [258, '57%',  '41%'],
  surge:  [161, '100%', '22%'],
  frost:  [199, '100%', '26%'],
  void:   [221, '100%', '35%'],
  dusk:   [32,  '100%', '31%'],
  ember:  [327, '82%',  '34%'],
}

function buildFaviconDataUri(accent: AccentColor, mode: ThemeMode): string {
  const [h, s, l] = mode === 'light' ? LIGHT_HSL[accent] : DARK_HSL[accent]
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
