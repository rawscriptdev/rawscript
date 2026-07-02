import { greet } from '@lib/greet'
import { exact } from 'exact'

const h1 = document.createElement('h1')
h1.id = 'paths-h1'
h1.textContent = `${greet} ${exact}`
document.body.appendChild(h1)
