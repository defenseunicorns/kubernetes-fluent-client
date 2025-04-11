// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

/** a is a collection of K8s types to be used within an action: `When(a.Configmap)` */
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
  V1Endpoints as Endpoints,
} from "@kubernetes/client-node";
export { GenericKind } from "./types";
