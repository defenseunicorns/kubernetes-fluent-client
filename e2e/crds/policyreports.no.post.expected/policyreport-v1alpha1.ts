/**
 * PolicyReport is the Schema for the policyreports API
 */
export interface PolicyReport {
  /**
   * APIVersion defines the versioned schema of this representation of an object. Servers
   * should convert recognized schemas to the latest internal value, and may reject
   * unrecognized values. More info:
   * https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#resources
   */
  apiVersion?: string;
  /**
   * Kind is a string value representing the REST resource this object represents. Servers may
   * infer this from the endpoint the client submits requests to. Cannot be updated. In
   * CamelCase. More info:
   * https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
   */
  kind?: string;
  metadata?: { [key: string]: any };
  /**
   * PolicyReportResult provides result details
   */
  results?: Result[];
  /**
   * Scope is an optional reference to the report scope (e.g. a Deployment, Namespace, or Node)
   */
  scope?: Scope;
  /**
   * ScopeSelector is an optional selector for multiple scopes (e.g. Pods). Either one of, or
   * none of, but not both of, Scope or ScopeSelector should be specified.
   */
  scopeSelector?: ScopeSelector;
  /**
   * PolicyReportSummary provides a summary of results
   */
  summary?: Summary;
  [property: string]: any;
}

/**
 * PolicyReportResult provides the result for an individual policy
 */
export interface Result {
  /**
   * Category indicates policy category
   */
  category?: string;
  /**
   * Data provides additional information for the policy rule
   */
  data?: { [key: string]: string };
  /**
   * Message is a short user friendly description of the policy rule
   */
  message?: string;
  /**
   * Policy is the name of the policy
   */
  policy: string;
  /**
   * Resources is an optional reference to the resource checked by the policy and rule
   */
  resources?: Resource[];
  /**
   * ResourceSelector is an optional selector for policy results that apply to multiple
   * resources. For example, a policy result may apply to all pods that match a label. Either
   * a Resource or a ResourceSelector can be specified. If neither are provided, the result is
   * assumed to be for the policy report scope.
   */
  resourceSelector?: ResourceSelector;
  /**
   * Rule is the name of the policy rule
   */
  rule?: string;
  /**
   * Scored indicates if this policy rule is scored
   */
  scored?: boolean;
  /**
   * Severity indicates policy severity
   */
  severity?: Severity;
  /**
   * Status indicates the result of the policy rule check
   */
  status?: Status;
  [property: string]: any;
}

/**
 * ResourceSelector is an optional selector for policy results that apply to multiple
 * resources. For example, a policy result may apply to all pods that match a label. Either
 * a Resource or a ResourceSelector can be specified. If neither are provided, the result is
 * assumed to be for the policy report scope.
 */
export interface ResourceSelector {
  /**
   * matchExpressions is a list of label selector requirements. The requirements are ANDed.
   */
  matchExpressions?: ResourceSelectorMatchExpression[];
  /**
   * matchLabels is a map of {key,value} pairs. A single {key,value} in the matchLabels map is
   * equivalent to an element of matchExpressions, whose key field is "key", the operator is
   * "In", and the values array contains only "value". The requirements are ANDed.
   */
  matchLabels?: { [key: string]: string };
  [property: string]: any;
}

/**
 * A label selector requirement is a selector that contains values, a key, and an operator
 * that relates the key and values.
 */
export interface ResourceSelectorMatchExpression {
  /**
   * key is the label key that the selector applies to.
   */
  key: string;
  /**
   * operator represents a key's relationship to a set of values. Valid operators are In,
   * NotIn, Exists and DoesNotExist.
   */
  operator: string;
  /**
   * values is an array of string values. If the operator is In or NotIn, the values array
   * must be non-empty. If the operator is Exists or DoesNotExist, the values array must be
   * empty. This array is replaced during a strategic merge patch.
   */
  values?: string[];
  [property: string]: any;
}

/**
 * ObjectReference contains enough information to let you inspect or modify the referred
 * object. --- New uses of this type are discouraged because of difficulty describing its
 * usage when embedded in APIs. 1. Ignored fields.  It includes many fields which are not
 * generally honored.  For instance, ResourceVersion and FieldPath are both very rarely
 * valid in actual usage. 2. Invalid usage help.  It is impossible to add specific help for
 * individual usage.  In most embedded usages, there are particular restrictions like, "must
 * refer only to types A and B" or "UID not honored" or "name must be restricted". Those
 * cannot be well described when embedded. 3. Inconsistent validation.  Because the usages
 * are different, the validation rules are different by usage, which makes it hard for users
 * to predict what will happen. 4. The fields are both imprecise and overly precise.  Kind
 * is not a precise mapping to a URL. This can produce ambiguity during interpretation and
 * require a REST mapping.  In most cases, the dependency is on the group,resource tuple and
 * the version of the actual struct is irrelevant. 5. We cannot easily change it.  Because
 * this type is embedded in many locations, updates to this type will affect numerous
 * schemas.  Don't make new APIs embed an underspecified API type they do not control.
 * Instead of using this type, create a locally provided and used type that is well-focused
 * on your reference. For example, ServiceReferences for admission registration:
 * https://github.com/kubernetes/api/blob/release-1.17/admissionregistration/v1/types.go#L533
 * .
 */
export interface Resource {
  /**
   * API version of the referent.
   */
  apiVersion?: string;
  /**
   * If referring to a piece of an object instead of an entire object, this string should
   * contain a valid JSON/Go field access statement, such as
   * desiredState.manifest.containers[2]. For example, if the object reference is to a
   * container within a pod, this would take on a value like: "spec.containers{name}" (where
   * "name" refers to the name of the container that triggered the event) or if no container
   * name is specified "spec.containers[2]" (container with index 2 in this pod). This syntax
   * is chosen only to have some well-defined way of referencing a part of an object. TODO:
   * this design is not final and this field is subject to change in the future.
   */
  fieldPath?: string;
  /**
   * Kind of the referent. More info:
   * https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
   */
  kind?: string;
  /**
   * Name of the referent. More info:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/names/#names
   */
  name?: string;
  /**
   * Namespace of the referent. More info:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/
   */
  namespace?: string;
  /**
   * Specific resourceVersion to which this reference is made, if any. More info:
   * https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#concurrency-control-and-consistency
   */
  resourceVersion?: string;
  /**
   * UID of the referent. More info:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/names/#uids
   */
  uid?: string;
  [property: string]: any;
}

/**
 * Severity indicates policy severity
 */
export enum Severity {
  High = "high",
  Low = "low",
  Medium = "medium",
}

/**
 * Status indicates the result of the policy rule check
 */
export enum Status {
  Error = "error",
  Fail = "fail",
  Pass = "pass",
  Skip = "skip",
  Warn = "warn",
}

/**
 * Scope is an optional reference to the report scope (e.g. a Deployment, Namespace, or Node)
 */
export interface Scope {
  /**
   * API version of the referent.
   */
  apiVersion?: string;
  /**
   * If referring to a piece of an object instead of an entire object, this string should
   * contain a valid JSON/Go field access statement, such as
   * desiredState.manifest.containers[2]. For example, if the object reference is to a
   * container within a pod, this would take on a value like: "spec.containers{name}" (where
   * "name" refers to the name of the container that triggered the event) or if no container
   * name is specified "spec.containers[2]" (container with index 2 in this pod). This syntax
   * is chosen only to have some well-defined way of referencing a part of an object. TODO:
   * this design is not final and this field is subject to change in the future.
   */
  fieldPath?: string;
  /**
   * Kind of the referent. More info:
   * https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
   */
  kind?: string;
  /**
   * Name of the referent. More info:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/names/#names
   */
  name?: string;
  /**
   * Namespace of the referent. More info:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/
   */
  namespace?: string;
  /**
   * Specific resourceVersion to which this reference is made, if any. More info:
   * https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#concurrency-control-and-consistency
   */
  resourceVersion?: string;
  /**
   * UID of the referent. More info:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/names/#uids
   */
  uid?: string;
  [property: string]: any;
}

/**
 * ScopeSelector is an optional selector for multiple scopes (e.g. Pods). Either one of, or
 * none of, but not both of, Scope or ScopeSelector should be specified.
 */
export interface ScopeSelector {
  /**
   * matchExpressions is a list of label selector requirements. The requirements are ANDed.
   */
  matchExpressions?: ScopeSelectorMatchExpression[];
  /**
   * matchLabels is a map of {key,value} pairs. A single {key,value} in the matchLabels map is
   * equivalent to an element of matchExpressions, whose key field is "key", the operator is
   * "In", and the values array contains only "value". The requirements are ANDed.
   */
  matchLabels?: { [key: string]: string };
  [property: string]: any;
}

/**
 * A label selector requirement is a selector that contains values, a key, and an operator
 * that relates the key and values.
 */
export interface ScopeSelectorMatchExpression {
  /**
   * key is the label key that the selector applies to.
   */
  key: string;
  /**
   * operator represents a key's relationship to a set of values. Valid operators are In,
   * NotIn, Exists and DoesNotExist.
   */
  operator: string;
  /**
   * values is an array of string values. If the operator is In or NotIn, the values array
   * must be non-empty. If the operator is Exists or DoesNotExist, the values array must be
   * empty. This array is replaced during a strategic merge patch.
   */
  values?: string[];
  [property: string]: any;
}

/**
 * PolicyReportSummary provides a summary of results
 */
export interface Summary {
  /**
   * Error provides the count of policies that could not be evaluated
   */
  error?: number;
  /**
   * Fail provides the count of policies whose requirements were not met
   */
  fail?: number;
  /**
   * Pass provides the count of policies whose requirements were met
   */
  pass?: number;
  /**
   * Skip indicates the count of policies that were not selected for evaluation
   */
  skip?: number;
  /**
   * Warn provides the count of unscored policies whose requirements were not met
   */
  warn?: number;
  [property: string]: any;
}
