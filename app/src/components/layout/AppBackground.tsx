export function AppBackground({ identity = false }: { identity?: boolean }) {
  if (!identity) {
    return <div className="pointer-events-none absolute inset-0 bg-sidebar" />
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-background">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/nus-soc-sea-building.jpg')" }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgb(5 32 57 / 58%), rgb(5 32 57 / 38%) 50%, rgb(5 32 57 / 58%))',
          }}
        />
      </div>
    </>
  )
}
