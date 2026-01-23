import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

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
