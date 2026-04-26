import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PROVIDER_DEFAULTS, type ProviderName } from '@/lib/chat-engine'
import { toast } from '@/components/ui/Toast'

const MODEL_ID_RE = /^[A-Za-z0-9._/-]+$/

interface LlmState {
  activeProvider: ProviderName
  customModels: Record<ProviderName, string[]>
  selectedModel: Record<ProviderName, string>
  setActiveProvider: (p: ProviderName) => void
  addCustomModel: (p: ProviderName, id: string) => void
  removeCustomModel: (p: ProviderName, id: string) => void
  setSelectedModel: (p: ProviderName, m: string) => void
  getModels: (p: ProviderName) => string[]
}

export const useLlmStore = create<LlmState>()(
  persist(
    (set, get) => ({
      activeProvider: 'openai',
      customModels: { openai: [], togetherai: [] },
      selectedModel: {
        openai: PROVIDER_DEFAULTS.openai.models[0],
        togetherai: PROVIDER_DEFAULTS.togetherai.models[0],
      },

      setActiveProvider: (p) => set({ activeProvider: p }),

      addCustomModel: (p, id) => {
        const trimmed = id.trim()
        if (!trimmed || !MODEL_ID_RE.test(trimmed) || trimmed.length > 200) {
          toast.error('Invalid model ID — use format "org/model-name"')
          return
        }
        const existing = [...PROVIDER_DEFAULTS[p].models, ...get().customModels[p]]
        if (existing.includes(trimmed)) {
          toast.error('Model already in list')
          return
        }
        set((s) => ({
          customModels: { ...s.customModels, [p]: [...s.customModels[p], trimmed] },
        }))
        toast.success(`Model added: ${trimmed}`)
      },

      removeCustomModel: (p, id) => {
        set((s) => {
          const updated = s.customModels[p].filter((m) => m !== id)
          const wasSelected = s.selectedModel[p] === id
          return {
            customModels: { ...s.customModels, [p]: updated },
            selectedModel: wasSelected
              ? { ...s.selectedModel, [p]: PROVIDER_DEFAULTS[p].models[0] }
              : s.selectedModel,
          }
        })
      },

      setSelectedModel: (p, m) =>
        set((s) => ({ selectedModel: { ...s.selectedModel, [p]: m } })),

      getModels: (p) => [
        ...PROVIDER_DEFAULTS[p].models,
        ...get().customModels[p],
      ],
    }),
    {
      name: 'mcp-one-llm',
      partialize: (s) => ({
        activeProvider: s.activeProvider,
        customModels: s.customModels,
        selectedModel: s.selectedModel,
      }),
    },
  ),
)
