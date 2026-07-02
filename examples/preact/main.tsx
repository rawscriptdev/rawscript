import { useState } from 'react'
import { render } from 'react-dom'

function App() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <h1>rawscript + Preact</h1>
      <button onClick={() => setCount((c) => c + 1)}>count: {count}</button>
    </div>
  )
}

render(<App />, document.getElementById('app')!)
