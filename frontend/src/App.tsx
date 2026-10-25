import { useEffect, useState } from 'react'
import { api } from './api'

function App() {
  const [health, setHealth] = useState('checking…')

  useEffect(() => {
    api('/health')
      .then((res) => res.json())
      .then((body: { status: string }) => setHealth(body.status))
      .catch(() => setHealth('unreachable'))
  }, [])

  return (
    <div>
      <h1>Hello World</h1>
      <p>Backend: {health}</p>
    </div>
  )
}

export default App
