import { kind,K8s, fetch } from "kubernetes-fluent-client";
import { beforeAll, afterAll,jest, test, describe, expect } from "@jest/globals";
import path from "path"
import { execSync } from "child_process";
jest.unmock("@kubernetes/client-node");

describe("KFC e2e test", () => {
    const clusterName = `kfc-dev`
    const namespace = `e2e-tests`
    const packedTarball = path.resolve(__dirname, `../../kubernetes-fluent-client-0.0.0-development.tgz.tgz`)

    const execCommand = (cmd: string) => {
        try {
            return execSync(cmd, {stdio: "inherit"})
        } catch (e) {
            console.error(e)
            throw e;
        }
    }

    // beforeAll(()=>{
       
    //     // execCommand(`npm pack`)
    //     // execCommand(`mv kubernetes-fluent-client-0.0.0-development.tgz ${packedTarball}`)
    //     // execCommand(`npm install ${packedTarball}`)
    // })

    // beforeAll(()=>{
    //     execCommand(`k3d cluster create ${clusterName} --k3s-arg '--debug@server:0' --wait && kubectl rollout status deployment -n kube-system && npm pack`)
    // })

    // afterAll(()=>{
    //     execCommand(`kind delete cluster --name ${clusterName}`)
    // })

    // test("kfc crd", () => {})
    test("kfc apply",async ()=>{
        try {
            await K8s(kind.Namespace).Apply({metadata:{name:namespace}})
        } catch (e) {
            expect(e).toBeUndefined()
        }

        try {
            const ns = await K8s(kind.Namespace).Get(namespace)
            expect(ns.metadata!.name).toBe(namespace)
        } catch (e) {
            expect(e).toBeDefined()
        }
    })

    test("kfc get name", async () => {
        const name = "kube-system"

        try {
            const ns = await K8s(kind.Namespace).Get(name)
            expect(ns.metadata!.name).toBe(name)
        } catch (e) {
            expect(e).toBeDefined()
        }
    })

    test("kfc get  all", async () => {
        const name = "kube-system"
        try {
            const nsList = await K8s(kind.Namespace).Get()
            expect(nsList.items.length).toBeGreaterThan(0)
            expect(nsList.items.find(ns => ns.metadata!.name === name)).toBeDefined()
        } catch (e) {
            expect(e).toBeUndefined()
        }
    })

    test("kfc delete", async ()=>{
        try {
            await K8s(kind.Namespace).Apply({metadata:{name:namespace}})
        } catch (e) {
            expect(e).toBeUndefined()
        }

        try {
            const ns = await K8s(kind.Namespace).Get(namespace)
            expect(ns.metadata!.name).toBe(namespace)
        } catch (e) {
            expect(e).toBeDefined()
        }

        try {
            await K8s(kind.Namespace).Delete(namespace)
        } catch (e) {
            expect(e).toBeUndefined()
        }

        try {
            const ns = await K8s(kind.Namespace).Get(namespace)
            expect(ns.metadata!.name).not.toBe(namespace)
        } catch (e) {
            expect(e).toBeDefined()
        }
    })
    // test("kfc logs",()=>{})
    test("kfc patch",()=>{
        // obj = await K8s(model, meta).Patch([
        //     {
        //       op: "replace",
        //       path: `/metadata/finalizers`,
        //       value: finalizers,
        //     },
        //   ]);
    })
       // test("kfc fetch",()=>{})
});
