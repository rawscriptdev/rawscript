import { useEffect, useState } from 'react'
import { render } from 'react-dom'
import { networkNote } from './lib.ts'

function App() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return (
    <div>
      <h1>rawscript offline-first</h1>
      <p id="network" data-network={online ? 'online' : 'offline'}>
        network: {online ? 'online' : 'offline'}
      </p>
      <p id="note">{networkNote()}</p>
      <p>
        Load this page once, then reload with esm.sh and unpkg unreachable.
        The page still renders: preact comes from the cache-first dependency
        cache, the compiled modules from the fingerprint cache.
      </p>
    </div>
  )
}

render(<App />, document.getElementById('app')!)