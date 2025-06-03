import { ClusterRole, ClusterRoleBinding, ConfigMap, CoreEvent, CronJob, CustomResourceDefinition, DaemonSet, Deployment, Endpoints, GenericKind, HorizontalPodAutoscaler, Ingress, Job, Namespace, NetworkPolicy, Node, PersistentVolume, PersistentVolumeClaim, Pod, PodDisruptionBudget, PodTemplate, ReplicaSet, ReplicationController, ResourceQuota, Role, RoleBinding, RuntimeClass, Secret, SelfSubjectAccessReview, SelfSubjectRulesReview, Service, ServiceAccount, StatefulSet, StorageClass, SubjectAccessReview, TokenReview, ValidatingWebhookConfiguration, VolumeAttachment } from "../src/upstream";
import { modelToGroupVersionKind } from "../src/index";
import { RegisterKind } from "../src/kinds";
import { expect, it } from "@jest/globals";

const testCases = [
  {
    name: Event,
    expected: { group: "events.k8s.io", version: "v1", kind: "Event" },
  },
  {
    name: CoreEvent,
    expected: { group: "", version: "v1", kind: "Event" },
  },
  {
    name: ClusterRole,
    expected: { group: "rbac.authorization.k8s.io", version: "v1", kind: "ClusterRole" },
  },
  {
    name: ClusterRoleBinding,
    expected: { group: "rbac.authorization.k8s.io", version: "v1", kind: "ClusterRoleBinding" },
  },
  {
    name: Role,
    expected: { group: "rbac.authorization.k8s.io", version: "v1", kind: "Role" },
  },
  {
    name: RoleBinding,
    expected: { group: "rbac.authorization.k8s.io", version: "v1", kind: "RoleBinding" },
  },
  { name: Pod, expected: { group: "", version: "v1", kind: "Pod" } },
  { name: Deployment, expected: { group: "apps", version: "v1", kind: "Deployment" } },
  { name: StatefulSet, expected: { group: "apps", version: "v1", kind: "StatefulSet" } },
  { name: DaemonSet, expected: { group: "apps", version: "v1", kind: "DaemonSet" } },
  { name: Job, expected: { group: "batch", version: "v1", kind: "Job" } },
  { name: CronJob, expected: { group: "batch", version: "v1", kind: "CronJob" } },
  { name: ConfigMap, expected: { group: "", version: "v1", kind: "ConfigMap" } },
  { name: Secret, expected: { group: "", version: "v1", kind: "Secret" } },
  { name: Service, expected: { group: "", version: "v1", kind: "Service" } },
  { name: ServiceAccount, expected: { group: "", version: "v1", kind: "ServiceAccount" } },
  { name: Namespace, expected: { group: "", version: "v1", kind: "Namespace" } },
  {
    name: HorizontalPodAutoscaler,
    expected: { group: "autoscaling", version: "v2", kind: "HorizontalPodAutoscaler" },
  },
  {
    name: CustomResourceDefinition,
    expected: { group: "apiextensions.k8s.io", version: "v1", kind: "CustomResourceDefinition" },
  },
  { name: Ingress, expected: { group: "networking.k8s.io", version: "v1", kind: "Ingress" } },
  {
    name: NetworkPolicy,
    expected: {
      group: "networking.k8s.io",
      version: "v1",
      kind: "NetworkPolicy",
      plural: "networkpolicies",
    },
  },
  { name: Node, expected: { group: "", version: "v1", kind: "Node" } },
  { name: PersistentVolume, expected: { group: "", version: "v1", kind: "PersistentVolume" } },
  {
    name: PersistentVolumeClaim,
    expected: { group: "", version: "v1", kind: "PersistentVolumeClaim" },
  },
  { name: Pod, expected: { group: "", version: "v1", kind: "Pod" } },
  {
    name: PodDisruptionBudget,
    expected: { group: "policy", version: "v1", kind: "PodDisruptionBudget" },
  },
  { name: PodTemplate, expected: { group: "", version: "v1", kind: "PodTemplate" } },
  { name: ReplicaSet, expected: { group: "apps", version: "v1", kind: "ReplicaSet" } },
  {
    name: ReplicationController,
    expected: { group: "", version: "v1", kind: "ReplicationController" },
  },
  { name: ResourceQuota, expected: { group: "", version: "v1", kind: "ResourceQuota" } },
  {
    name: RuntimeClass,
    expected: { group: "node.k8s.io", version: "v1", kind: "RuntimeClass" },
  },
  { name: Secret, expected: { group: "", version: "v1", kind: "Secret" } },
  {
    name: SelfSubjectAccessReview,
    expected: { group: "authorization.k8s.io", version: "v1", kind: "SelfSubjectAccessReview" },
  },
  {
    name: SelfSubjectRulesReview,
    expected: { group: "authorization.k8s.io", version: "v1", kind: "SelfSubjectRulesReview" },
  },
  { name: Service, expected: { group: "", version: "v1", kind: "Service" } },
  { name: ServiceAccount, expected: { group: "", version: "v1", kind: "ServiceAccount" } },
  { name: StatefulSet, expected: { group: "apps", version: "v1", kind: "StatefulSet" } },
  {
    name: StorageClass,
    expected: { group: "storage.k8s.io", version: "v1", kind: "StorageClass" },
  },
  {
    name: SubjectAccessReview,
    expected: { group: "authorization.k8s.io", version: "v1", kind: "SubjectAccessReview" },
  },
  {
    name: TokenReview,
    expected: { group: "authentication.k8s.io", version: "v1", kind: "TokenReview" },
  },
  {
    name: ValidatingWebhookConfiguration,
    expected: {
      group: "admissionregistration.k8s.io",
      version: "v1",
      kind: "ValidatingWebhookConfiguration",
    },
  },
  {
    name: VolumeAttachment,
    expected: { group: "storage.k8s.io", version: "v1", kind: "VolumeAttachment" },
  },
  {
    name: Endpoints,
    expected: { group: "", version: "v1", kind: "Endpoints", plural: "endpoints" },
  },
];

it.each(testCases)(
  "should return the correct GroupVersionKind for '%s'",
  ({ name, expected }) => {
    const { name: modelName } = name;
    const gvk = modelToGroupVersionKind(modelName);
    try {
      expect(gvk.group).toBe(expected.group);
      expect(gvk.version).toBe(expected.version);
      expect(gvk.kind).toBe(expected.kind);
    } catch (error) {
      console.error(
        `Failed for model ${modelName}: Expected GroupVersionKind to be ${JSON.stringify(
          expected,
        )}, but got ${JSON.stringify(gvk)}`,
      );
      throw error;
    }
  },
);

it("registers a new type", () => {
    class UnicornKind extends GenericKind {
    }

    try {
      RegisterKind(UnicornKind, {
        group: "pepr.dev",
        version: "v1",
        kind: "Unicorn",
      });
    }  catch (e) {
      expect(e).not.toBeDefined();
    }
})

it("throws an error if the kind is already registered", () => {
    class UnicornKind extends GenericKind {}

    try {
      RegisterKind(UnicornKind, {
        group: "pepr.dev",
        version: "v1",
        kind: "Unicorn",
      });
    }  catch (e) {
      expect(e).toBeDefined();
    }
})
