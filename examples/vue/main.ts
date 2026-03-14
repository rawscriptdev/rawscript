import { createApp, h, ref } from 'vue'

const App = {
  setup() {
    const count = ref(0)
    return () =>
      h('div', [
        h('h1', 'rawscript + Vue'),
        h(
          'button',
          { onClick: () => count.value++ },
          `count: ${count.value}`
        ),
      ])
  },
}

createApp(App).mount('#app')
