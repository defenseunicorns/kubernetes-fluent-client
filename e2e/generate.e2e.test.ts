import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { kind, K8s, fetch, GenericClass, KubernetesObject } from "kubernetes-fluent-client";


jest.unmock("@kubernetes/client-node")
describe("Generate e2e tests", () =>{
  const namespace = `kfc-generate`;

  it("convertCRDtoTS should generate the expected TypeScript file", async () => {
    
  })

  describe("when reading or fetching CRDs", () => {
    it("should load CRDs from a local file", () =>{

    })
  })

  describe("when reading or fetching CRDs from a URL", () =>{
    it("should fetch CRD from a URL and parse YAML", ()=>{

    })
  })

  describe("when reading or fetching from a Kubernetes cluster", ()=>{
    it("should load CRD from Kubernetes cluster", ()=>{

    })
    it("should log an error if Kubernetes cluster read fails", () =>{

    })
  })

  describe("readOrFetchCrd Error handling", () =>{
    it("should throw an error if file reading fails", () =>{

    })
  })

  describe("convertCRDtoTS with an invalid CRD", () => {
    it("should handle schema with no OpenAPI schema", () =>{

    })
  })

})