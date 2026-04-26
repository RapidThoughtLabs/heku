export function TypingIndicator() {
  return (
    <div style={{ display: 'inline-flex', gap: 5, padding: '10px 0 6px 21px' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--accent)',
            opacity: 0.4,
            display: 'block',
            animation: `typingBounce 1.2s infinite ${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  )
}
