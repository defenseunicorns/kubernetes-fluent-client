import { TargetLanguage } from "quicktype-core";
import { LogFn } from "./types";
export interface GenerateOptions {
    /** The source URL, yaml file path or K8s CRD name */
    source: string;
    /** The output directory path */
    directory?: string;
    /** Disable kubernetes-fluent-client wrapping */
    plain?: boolean;
    /** The language to generate types in */
    language?: string | TargetLanguage;
    /** Override the NPM package to import when generating formatted Typescript */
    npmPackage?: string;
    /** Log function callback */
    logFn: LogFn;
}
/**
 * Generate TypeScript types from a K8s CRD
 *
 * @param opts The options to use when generating
 * @returns A promise that resolves when the TypeScript types have been generated
 */
export declare function generate(opts: GenerateOptions): Promise<Record<string, string[]>>;
//# sourceMappingURL=generate.d.ts.map