// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import {
  ArrayType,
  UnionType,
  TypeScriptRenderer,
  TypeScriptTargetLanguage,
  getOptionValues,
  parenIfNeeded,
  singleWord,
  tsFlowOptions,
  type LanguageName,
  type MultiWord,
  type RenderContext,
  type RendererOptions,
} from "quicktype-core";

class CompatibleTypeScriptRenderer extends TypeScriptRenderer {
  // Retain quicktype 25 array syntax, including for schemas with minItems.
  // Modern generated types are tracked in https://github.com/defenseunicorns/kubernetes-fluent-client/issues/1335.
  protected override sourceForArrayType(arrayType: ArrayType): MultiWord {
    const itemType = this.sourceFor(arrayType.items);
    if (
      (arrayType.items instanceof UnionType && !this._tsFlowOptions.declareUnions) ||
      arrayType.items instanceof ArrayType
    ) {
      return singleWord(["Array<", itemType.source, ">"]);
    }
    return singleWord([parenIfNeeded(itemType), "[]"]);
  }
}

export class CompatibleTypeScriptTargetLanguage extends TypeScriptTargetLanguage {
  protected override makeRenderer<Lang extends LanguageName = "typescript">(
    renderContext: RenderContext,
    untypedOptionValues: RendererOptions<Lang>,
  ): TypeScriptRenderer {
    return new CompatibleTypeScriptRenderer(
      this,
      renderContext,
      getOptionValues(tsFlowOptions, untypedOptionValues),
    );
  }
}
