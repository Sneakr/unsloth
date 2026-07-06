// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import {
  type CachedInventoryRow,
  type LocalInventoryRow,
  looksLikeLocalPath,
  useHubInventory,
} from "@/features/hub";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { isUntrainableModelFormat } from "../lib/model-support";
import {
  type TrainingResourceNotice,
  completeResourceSet,
  resolveTrainingResourceNotice,
} from "../lib/resource-availability";
import { useTrainingConfigStore } from "../stores/training-config-store";

function usableModelRow(row: CachedInventoryRow | LocalInventoryRow): boolean {
  if (isUntrainableModelFormat(row.modelFormat)) return false;
  return row.kind === "cache" || row.source === "hf_cache";
}

export function useTrainingResourceNotices(): TrainingResourceNotice[] {
  const {
    selectedModel,
    modelKnownCached,
    modelLocalPath,
    datasetSource,
    dataset,
    datasetKnownCached,
    datasetLocalPath,
  } = useTrainingConfigStore(
    useShallow((s) => ({
      selectedModel: s.selectedModel,
      modelKnownCached: s.modelKnownCached,
      modelLocalPath: s.modelLocalPath,
      datasetSource: s.datasetSource,
      dataset: s.dataset,
      datasetKnownCached: s.datasetKnownCached,
      datasetLocalPath: s.datasetLocalPath,
    })),
  );

  const modelIsLocal = !!selectedModel && looksLikeLocalPath(selectedModel);
  const datasetIsHf = datasetSource === "huggingface" && !!dataset;
  const modelInventory = useHubInventory({
    kind: "models",
    enabled: !!selectedModel && !modelIsLocal,
  });
  const datasetInventory = useHubInventory({
    kind: "datasets",
    enabled: datasetIsHf,
  });

  return useMemo(() => {
    const notices: TrainingResourceNotice[] = [];
    const modelNotice = resolveTrainingResourceNotice({
      kind: "model",
      id: selectedModel,
      isLocal: modelIsLocal,
      knownCached: modelKnownCached,
      localPath: modelLocalPath,
      completeSet: completeResourceSet(
        [...modelInventory.cachedRows, ...modelInventory.localRows].filter(
          usableModelRow,
        ),
      ),
      partialSet: modelInventory.partialSet,
    });
    if (modelNotice) notices.push(modelNotice);

    const datasetNotice = resolveTrainingResourceNotice({
      kind: "dataset",
      id: dataset,
      isLocal: !datasetIsHf,
      knownCached: datasetKnownCached,
      localPath: datasetLocalPath,
      completeSet: completeResourceSet([
        ...datasetInventory.cachedRows,
        ...datasetInventory.localRows,
      ]),
      partialSet: datasetInventory.partialSet,
    });
    if (datasetNotice) notices.push(datasetNotice);

    return notices;
  }, [
    selectedModel,
    modelIsLocal,
    modelKnownCached,
    modelLocalPath,
    modelInventory.cachedRows,
    modelInventory.localRows,
    modelInventory.partialSet,
    dataset,
    datasetIsHf,
    datasetKnownCached,
    datasetLocalPath,
    datasetInventory.cachedRows,
    datasetInventory.localRows,
    datasetInventory.partialSet,
  ]);
}
