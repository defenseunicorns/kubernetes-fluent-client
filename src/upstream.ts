// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

/** a is a collection of K8s types to be used within an action: `When(a.Configmap)` */
import { V1Endpoint, V1ObjectMeta } from "@kubernetes/client-node";
import { RegisterKind } from "./kinds";
export {
  CoreV1Event as CoreEvent,
  EventsV1Event as Event,
  V1APIService as APIService,
  V1CertificateSigningRequest as CertificateSigningRequest,
  V1ClusterRole as ClusterRole,
  V1ClusterRoleBinding as ClusterRoleBinding,
  V1ConfigMap as ConfigMap,
  V1ControllerRevision as ControllerRevision,
  V1CronJob as CronJob,
  V1CSIDriver as CSIDriver,
  V1CustomResourceDefinition as CustomResourceDefinition,
  V1DaemonSet as DaemonSet,
  V1Deployment as Deployment,
  V1EndpointSlice as EndpointSlice,
  V1HorizontalPodAutoscaler as HorizontalPodAutoscaler,
  V1Ingress as Ingress,
  V1IngressClass as IngressClass,
  V1Job as Job,
  V1LimitRange as LimitRange,
  V1LocalSubjectAccessReview as LocalSubjectAccessReview,
  V1MutatingWebhookConfiguration as MutatingWebhookConfiguration,
  V1Namespace as Namespace,
  V1NetworkPolicy as NetworkPolicy,
  V1Node as Node,
  V1PersistentVolume as PersistentVolume,
  V1PersistentVolumeClaim as PersistentVolumeClaim,
  V1Pod as Pod,
  V1PodDisruptionBudget as PodDisruptionBudget,
  V1PodTemplate as PodTemplate,
  V1ReplicaSet as ReplicaSet,
  V1ReplicationController as ReplicationController,
  V1ResourceQuota as ResourceQuota,
  V1Role as Role,
  V1RoleBinding as RoleBinding,
  V1RuntimeClass as RuntimeClass,
  V1Secret as Secret,
  V1SelfSubjectAccessReview as SelfSubjectAccessReview,
  V1SelfSubjectRulesReview as SelfSubjectRulesReview,
  V1Service as Service,
  V1ServiceAccount as ServiceAccount,
  V1StatefulSet as StatefulSet,
  V1StorageClass as StorageClass,
  V1SubjectAccessReview as SubjectAccessReview,
  V1TokenReview as TokenReview,
  V1ValidatingWebhookConfiguration as ValidatingWebhookConfiguration,
  V1VolumeAttachment as VolumeAttachment,
  // V1Endpoint as Endpoint, - keep this so we do not forget incase it is corrected
} from "@kubernetes/client-node";

export { GenericKind } from "./types";

export class Endpoint {
  /**
   * APIVersion defines the versioned schema of this representation of an object. Servers should convert recognized schemas to the latest internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#resources
   */
  apiVersion: string = "v1";
  /**
   * Kind is a string value representing the REST resource this object represents. Servers may infer this from the endpoint the client submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
   */
  kind: string = "Endpoint";

  metadata?: V1ObjectMeta;

  /**
   * The generated type only contains a single subnet, should should be an array
   * kubectl explain ep
   */
  subnets?: V1Endpoint[];

  constructor(init?: Partial<Endpoint>) {
    Object.assign(this, init);
  }
}

RegisterKind(Endpoint, {
  group: "",
  version: "v1",
  kind: "Endpoints",
  plural: "endpoints",
});
