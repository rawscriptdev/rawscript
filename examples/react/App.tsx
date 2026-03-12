import { useState } from 'react'
import { createRoot } from 'react-dom/client'

const App = () => {
  const [count, setCount] = useState(0)
  return (
    <div>
      <h1>rawscript + React</h1>
      <button onClick={() => setCount(c => c + 1)}>
        count: {count}
      </button>
    </div>
  )
}

createRoot(document.getElementById('app')!).render(<App />)
