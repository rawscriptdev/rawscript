import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'

function App() {
  const [count, setCount] = createSignal(0)
  return (
    <div>
      <h1>rawscript + Solid</h1>
      <button onClick={() => setCount((c) => c + 1)}>count: {count()}</button>
    </div>
  )
}

render(() => <App />, document.getElementById('app')!)
