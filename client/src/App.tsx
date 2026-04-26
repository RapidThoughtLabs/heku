import { useEffect } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { ServerConnect } from '@/components/connect/ServerConnect'
import { useAppStore } from '@/stores/app-store'
import { loadTheme, applyTheme, applyFontSize } from '@/lib/theme'
import { useMcpServer } from '@/hooks/useMcpServer'

function ConnectedApp() {
  // Only poll server health + tools when we have an active connection
  useMcpServer()
  return <AppShell />
}

function App() {
  const { setMode, setAccent, setFontSize, connectedEndpoint } = useAppStore()

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
