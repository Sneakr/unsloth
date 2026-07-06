// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import {
  fetchInventorySource,
  looksLikeLocalPath,
  useHfTokenStore,
  useInventoryVersion,
} from "@/features/hub";
import {
  cachedInventoryPathMatchesSelection,
  isUntrainableModelFormat,
  useTrainingConfigStore,
} from "@/features/training";
import { translate } from "@/i18n";
import { toast } from "@/lib/toast";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

export function useTrainingCacheReconciliation(): void {
  const inventoryVersion = useInventoryVersion();
  const hfToken = useHfTokenStore((s) => s.token);
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

  useEffect(() => {
    if (datasetSource !== "huggingface" || !dataset || !datasetKnownCached) {
      return;
    }
    let cancelled = false;
    const expectedDataset = dataset;
    const expectedLocalPath = datasetLocalPath;
    void fetchInventorySource("cachedDatasets", { inventoryVersion, hfToken })
      .then((rows) => {
        if (cancelled) return;
        const current = useTrainingConfigStore.getState();
        if (
          current.datasetSource !== "huggingface" ||
          current.dataset !== expectedDataset ||
          !current.datasetKnownCached
        ) {
          return;
        }
        const stillCached = rows.some(
          (row) =>
            !row.partial &&
            row.repo_id.toLowerCase() === expectedDataset.toLowerCase() &&
            cachedInventoryPathMatchesSelection(
              row.cache_path,
              expectedLocalPath,
            ),
        );
        if (stillCached) return;
        current.clearSelectedDatasetCacheReference(
          expectedDataset,
          expectedLocalPath,
        );
        toast.warning(translate("studio.wizard.cachedDatasetGoneTitle"), {
          description: translate("studio.wizard.cachedDatasetGoneDescription"),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    inventoryVersion,
    hfToken,
    datasetSource,
    dataset,
    datasetKnownCached,
    datasetLocalPath,
  ]);

  useEffect(() => {
    if (!selectedModel || looksLikeLocalPath(selectedModel)) {
      return;
    }
    let cancelled = false;
    const expectedModel = selectedModel;
    const expectedLocalPath = modelLocalPath;
    const wasKnownCached = modelKnownCached;
    void Promise.all([
      fetchInventorySource("cachedModels", { inventoryVersion, hfToken }),
      fetchInventorySource("localModels", { inventoryVersion, hfToken }),
    ])
      .then(([cachedRows, localRows]) => {
        if (cancelled) return;
        const current = useTrainingConfigStore.getState();
        if (current.selectedModel !== expectedModel) return;

        const key = expectedModel.toLowerCase();
        const cachedMatch = cachedRows.find(
          (row) =>
            !row.partial &&
            !isUntrainableModelFormat(row.model_format) &&
            (row.repo_id.toLowerCase() === key ||
              row.load_id?.toLowerCase() === key),
        );
        const localMatch = localRows.find(
          (row) =>
            row.source === "hf_cache" &&
            !isUntrainableModelFormat(row.model_format) &&
            (row.model_id?.toLowerCase() === key ||
              row.load_id?.toLowerCase() === key ||
              row.id.toLowerCase() === key),
        );
        const reference = cachedMatch
          ? {
              localPath: cachedMatch.cache_path ?? null,
              modelFormat: cachedMatch.model_format ?? null,
            }
          : localMatch
            ? {
                localPath: localMatch.path,
                modelFormat: localMatch.model_format ?? null,
              }
            : null;

        if (wasKnownCached && current.modelKnownCached) {
          const stillMatches =
            reference !== null &&
            cachedInventoryPathMatchesSelection(
              reference.localPath,
              expectedLocalPath,
            );
          if (!stillMatches) {
            current.clearSelectedModelCacheReference(
              expectedModel,
              expectedLocalPath,
            );
            toast.warning(translate("studio.wizard.cachedModelGoneTitle"), {
              description: translate(
                "studio.wizard.cachedModelGoneDescription",
              ),
            });
          }
          return;
        }

        if (!current.modelKnownCached && reference) {
          current.setSelectedModelCacheReference(expectedModel, reference);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    inventoryVersion,
    hfToken,
    selectedModel,
    modelKnownCached,
    modelLocalPath,
  ]);
}
