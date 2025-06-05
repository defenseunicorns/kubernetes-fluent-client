```
k3d cluster delete --all; 
k3d cluster create kfc-dev --k3s-arg '--debug@server:0' --wait && kubectl rollout status deployment -n kube-system;
kubectl apply -f test/ && npx tsx src/cli.ts crd ./test/datastore.crd.yaml e2e && npx tsx src/cli.ts crd https://raw.githubusercontent.com/defenseunicorns/kubernetes-fluent-client/refs/heads/main/test/webapp.crd.yaml e2e;
sed -i 's|from "kubernetes-fluent-client"|from "../src"|g' e2e/datastore-v1alpha1.ts;sed -i 's|from "kubernetes-fluent-client"|from "../src"|g' e2e/webapp-v1alpha1.ts;
npm run build;
npm pack;
npm i kubernetes-fluent-client-0.0.0-development.tgz --no-save;
npm run test:e2e
```
