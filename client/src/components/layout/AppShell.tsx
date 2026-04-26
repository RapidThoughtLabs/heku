import { Sidebar } from './Sidebar'
import { McpPanel } from './McpPanel'
import { ChatView } from '@/components/chat/ChatView'
import { ConfigsView } from '@/components/configs/ConfigsView'
import { RegistryView } from '@/components/registry/RegistryView'
import { LogsView } from '@/components/logs/LogsView'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { Toaster } from '@/components/ui/Toast'
import { useAppStore } from '@/stores/app-store'
import { Sparkles } from 'lucide-react'

function PromptsView() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--text-dim)' }}>
      <Sparkles size={28} style={{ opacity: 0.25 }} />
      <div style={{ fontSize: 11, letterSpacing: '0.1em' }}>Prompt templates</div>
      <span
        style={{
          fontSize: 9,
          padding: '3px 10px',
          borderRadius: 99,
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          letterSpacing: '0.1em',
          fontWeight: 600,
        }}
      >
        COMING IN PHASE B
      </span>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', opacity: 0.6, maxWidth: 300, textAlign: 'center', lineHeight: 1.7 }}>
        Reusable prompt templates for common tool workflows will be available in the next phase.
      </div>
    </div>
  )
}

const PAGE_COMPONENTS = {
  demo: ChatView,
  configs: ConfigsView,
  registry: RegistryView,
  logs: LogsView,
  prompts: PromptsView,
}

export function AppShell() {
  const { activePage } = useAppStore()
  const PageComponent = PAGE_COMPONENTS[activePage]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', background: 'var(--bg)' }}>
        <PageComponent />
      </main>

      <McpPanel />

      <SettingsModal />
      <Toaster />
    </div>
  )
}
