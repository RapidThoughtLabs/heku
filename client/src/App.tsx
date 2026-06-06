import { useEffect } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { ServerConnect } from '@/components/connect/ServerConnect'
import { useAppStore } from '@/stores/app-store'
import { loadTheme, applyTheme, applyFontSize } from '@/lib/theme'
import { useMcpServer } from '@/hooks/useMcpServer'
import { useFaviconState } from '@/hooks/useFaviconState'

function ConnectedApp() {
  useMcpServer()
  return <AppShell />
}

function App() {
  const { setMode, setAccent, setFontSize, connectedEndpoint } = useAppStore()
  useFaviconState()

  useEffect(() => {
    const { mode, accent, fontSize } = loadTheme()
    setMode(mode)
    setAccent(accent)
    setFontSize(fontSize)
    applyTheme(mode, accent)
    applyFontSize(fontSize)
  }, [setMode, setAccent, setFontSize])

  if (!connectedEndpoint) {
    return <ServerConnect />
  }

  return <ConnectedApp />
}

export default App
