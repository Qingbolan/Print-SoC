import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'leaflet/dist/leaflet.css'
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css'
import './styles/globals.css'

// Set by the native window builder only when macOS provides the material.
if ((window as Window & { __PRINT_SOC_NATIVE_MATERIAL__?: boolean }).__PRINT_SOC_NATIVE_MATERIAL__) {
  document.documentElement.dataset.nativeMaterial = 'acrylic'
}

// Global function to hide splash - called when ready to show content
;(window as unknown as { hideSplash: () => void }).hideSplash = () => {
  const splash = document.getElementById('splash-screen')
  if (splash) {
    splash.classList.add('hidden')
    setTimeout(() => splash.remove(), 300)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
