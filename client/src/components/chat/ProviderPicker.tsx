import { useState } from 'react'
import { Bot, Eye, EyeOff, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SegCtrl } from '@/components/ui/SegCtrl'
import { PROVIDER_DEFAULTS, type ProviderConfig, type ProviderName } from '@/lib/chat-engine'
import { useLlmStore } from '@/stores/llm-store'

interface ProviderPickerProps {
  open: boolean
  onClose: () => void
  onSave: (config: ProviderConfig) => void
  current?: ProviderConfig | null
}

export function ProviderPicker({ open, onClose, onSave, current }: ProviderPickerProps) {
  const { customModels, selectedModel, setSelectedModel, customBaseUrl, setCustomBaseUrl } = useLlmStore()

  const initialProvider: ProviderName = current?.provider ?? 'openai'
  const [provider, setProvider] = useState<ProviderName>(initialProvider)
  const [model, setModel] = useState(
    current?.model ?? selectedModel[initialProvider] ?? PROVIDER_DEFAULTS[initialProvider].models[0]
  )
  const [apiKey, setApiKey] = useState(current?.apiKey ?? '')
  const [customUrl, setCustomUrl] = useState(
    current?.provider === 'custom' ? current.baseUrl : customBaseUrl
  )
  const [showKey, setShowKey] = useState(false)

  if (!open) return null

  const defaults = PROVIDER_DEFAULTS[provider]
  const builtInModels = PROVIDER_DEFAULTS[provider].models
  const customList = customModels[provider]
  const allModels = [...builtInModels, ...customList]

  const handleProviderChange = (p: ProviderName) => {
    setProvider(p)
    setModel(selectedModel[p] ?? PROVIDER_DEFAULTS[p].models[0] ?? '')
  }

  const baseUrl = provider === 'custom' ? customUrl.trim().replace(/\/+$/, '') : defaults.baseUrl
  const canSave = !!apiKey.trim() && !!model && (provider !== 'custom' || !!baseUrl)

  const handleSave = () => {
    if (!canSave) return
    setSelectedModel(provider, model)
    if (provider === 'custom') setCustomBaseUrl(baseUrl)
    onSave({
      provider,
      apiKey: apiKey.trim(),
      model,
      baseUrl,
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'overlayIn 0.15s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          width: 400,
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          animation: 'modalIn 0.15s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Bot size={16} style={{ color: 'var(--accent)' }} />
          <span
            style={{
              fontSize: '0.92rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: 'var(--text)',
            }}
          >
            Connect LLM Provider
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 18px 14px' }}>
          {/* Provider selector */}
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                fontSize: '0.77rem',
                color: 'var(--text-dim)',
                letterSpacing: '0.1em',
                display: 'block',
                marginBottom: 6,
              }}
            >
              PROVIDER
            </label>
            <SegCtrl
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'togetherai', label: 'Together AI' },
                { value: 'custom', label: 'Custom' },
              ]}
              value={provider}
              onChange={(v) => handleProviderChange(v as ProviderName)}
            />
          </div>

          {/* Base URL — custom provider only */}
          {provider === 'custom' && (
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  fontSize: '0.77rem',
                  color: 'var(--text-dim)',
                  letterSpacing: '0.1em',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                BASE URL
              </label>
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://my-endpoint.example.com/v1"
                style={{
                  width: '100%',
                  background: 'var(--bg)',
                  border: '1px solid var(--border2)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                  letterSpacing: '0.02em',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.5)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border2)' }}
              />
            </div>
          )}

          {/* Model selector */}
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                fontSize: '0.77rem',
                color: 'var(--text-dim)',
                letterSpacing: '0.1em',
                display: 'block',
                marginBottom: 6,
              }}
            >
              MODEL
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={allModels.length === 0}
              style={{
                width: '100%',
                background: 'var(--bg)',
                border: '1px solid var(--border2)',
                borderRadius: 6,
                padding: '8px 12px',
                color: 'var(--text)',
                fontSize: '0.85rem',
                fontFamily: "'JetBrains Mono', monospace",
                outline: 'none',
                cursor: allModels.length === 0 ? 'not-allowed' : 'pointer',
                opacity: allModels.length === 0 ? 0.5 : 1,
              }}
            >
              {allModels.length === 0 && (
                <option value="">No models — add one in Settings → LLM</option>
              )}
              {builtInModels.length > 0 && (
                <optgroup label="Provided">
                  {builtInModels.map((m) => (
                    <option key={m} value={m} style={{ background: 'var(--surface)' }}>{m}</option>
                  ))}
                </optgroup>
              )}
              {customList.length > 0 && (
                <optgroup label="Custom">
                  {customList.map((m) => (
                    <option key={m} value={m} style={{ background: 'var(--surface)' }}>{m}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* API key */}
          <div style={{ marginBottom: 6 }}>
            <label
              style={{
                fontSize: '0.77rem',
                color: 'var(--text-dim)',
                letterSpacing: '0.1em',
                display: 'block',
                marginBottom: 6,
              }}
            >
              API KEY
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
                placeholder={
                  provider === 'openai' ? 'sk-...' : provider === 'togetherai' ? 'your-together-api-key' : 'your-api-token'
                }
                autoFocus
                style={{
                  width: '100%',
                  background: 'var(--bg)',
                  border: '1px solid var(--border2)',
                  borderRadius: 6,
                  padding: '8px 38px 8px 12px',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                  letterSpacing: '0.04em',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor =
                    'hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.5)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border2)'
                }}
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                  display: 'flex',
                  padding: 2,
                }}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          <div
            style={{
              fontSize: '0.69rem',
              color: 'var(--text-dim)',
              letterSpacing: '0.06em',
              lineHeight: 1.65,
              marginBottom: 18,
            }}
          >
            Stored in session memory only · never written to disk
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!canSave}
              onClick={handleSave}
            >
              Connect
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
