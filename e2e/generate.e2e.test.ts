import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { kind, K8s, fetch, GenericClass, KubernetesObject } from "kubernetes-fluent-client";


jest.unmock("@kubernetes/client-node")
describe("Generate e2e tests", () =>{
  const namespace = `kfc-generate`;

  it("convertCRDtoTS should generate the expected TypeScript file", async () => {
    // Covered by 'cli.e2e.test.ts - should generate TypeScript types and run post-processing for ${name}'
  })

  describe("when reading or fetching CRDs", () => {
    it("should load CRDs from a local file", () =>{
      // Covered by 'cli.e2e.test.ts - should generate TypeScript types and run post-processing for ${name}'
      // Reads from mocked YAML file
    })
  })

  describe("when reading or fetching CRDs from a URL", () =>{
    it("should fetch CRD from a URL and parse YAML", ()=>{
        //test:e2e:prep-crds seems relevant
        // kubectl apply -f test/ && npx ts-node src/cli.ts crd ./test/datastore.crd.yaml e2e &&
        // npx ts-node src/cli.ts crd https://raw.githubusercontent.com/defenseunicorns/kubernetes-fluent-client/refs/heads/main/test/webapp.crd.yaml e2e
    })
  })

  describe("when reading or fetching from a Kubernetes cluster", ()=>{
    it("should load CRD from Kubernetes cluster", ()=>{
        //test:e2e:prep-crds seems relevant
        // kubectl apply -f test/ && npx ts-node src/cli.ts crd ./test/datastore.crd.yaml e2e &&
        // npx ts-node src/cli.ts crd https://raw.githubusercontent.com/defenseunicorns/kubernetes-fluent-client/refs/heads/main/test/webapp.crd.yaml e2e
    })
    it("should log an error if Kubernetes cluster read fails", () =>{
        //test:e2e:prep-crds seems relevant
        // kubectl apply -f test/ && npx ts-node src/cli.ts crd ./test/datastore.crd.yaml e2e &&
        // npx ts-node src/cli.ts crd https://raw.githubusercontent.com/defenseunicorns/kubernetes-fluent-client/refs/heads/main/test/webapp.crd.yaml e2e
    })
  })

  describe("readOrFetchCrd Error handling", () =>{
    it("should throw an error if file reading fails", () =>{
      // Could do something like reading from a file that's not there
    })
  })

  describe("convertCRDtoTS with an invalid CRD", () => {
    it("should handle schema with no OpenAPI schema", () =>{
      // Read in an otherwise-good file
    })
  })

})