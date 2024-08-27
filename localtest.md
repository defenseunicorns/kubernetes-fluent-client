```ts
const { K8s, kind } = require("./dist/index.js")

const watch = K8s(kind.Pod).Watch(po => console.log(JSON.stringify(pod)))

watch.start()
```
