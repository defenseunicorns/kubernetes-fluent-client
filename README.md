# Kubernetes Fluent Client for Node

[![Npm package license](https://badgen.net/npm/license/kubernetes-fluent-client)](https://npmjs.com/package/kubernetes-fluent-client)
[![Known Vulnerabilities](https://snyk.io/test/npm/kubernetes-fluent-client/badge.svg)](https://snyk.io/advisor/npm-package/kubernetes-fluent-client)
[![Npm package version](https://badgen.net/npm/v/kubernetes-fluent-client)](https://npmjs.com/package/kubernetes-fluent-client)
[![Npm package total downloads](https://badgen.net/npm/dt/kubernetes-fluent-client)](https://npmjs.com/package/kubernetes-fluent-client)

```typescript
import { K8s, kind } from "kubernetes-fluent-client";

async function main() {
  const pods = await K8s(kind.Pod).Get();
  console.log(pods);
}
```
