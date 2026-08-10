export function AppBackground({ identity = false }: { identity?: boolean }) {
  if (!identity) {
    return <div className="pointer-events-none absolute inset-0 bg-sidebar" />
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-background">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/nus-soc-login-background.png')" }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, color-mix(in srgb, var(--background) 74%, transparent), color-mix(in srgb, var(--background) 52%, transparent) 50%, color-mix(in srgb, var(--background) 74%, transparent))',
          }}
        />
      </div>
    </>
  )
}
