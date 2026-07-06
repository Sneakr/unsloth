// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import {
  shouldShowTrainingView,
  useDatasetPreviewDialogStore,
  useTrainingConfigStore,
  useTrainingRuntimeLifecycle,
  useTrainingRuntimeStore,
} from "@/features/training";
import { useHfTokenStore } from "@/features/hub/stores/hf-token-store";
import { GuidedTour, useGuidedTourController } from "@/features/tour";
import { studioTourSteps, studioTrainingTourSteps } from "./tour";
import { Button } from "@/components/ui/button";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { DatasetPreviewDialog } from "./sections/dataset-preview-dialog";
import { LiveTrainingView } from "./live-training-view";
import { HistoricalTrainingView } from "./historical-training-view";
import { HistoryCardGrid } from "./history-card-grid";
import { useTrainingCacheReconciliation } from "./hooks/use-training-cache-reconciliation";
import { RunPreviewCard } from "./wizard/run-preview-card";
import { StartTrainingCta, TrainingWizard } from "./wizard/training-wizard";
import { useT } from "@/i18n";

type TrainSubTab = "configure" | "current-run" | "history";

function TrainSubNav({
  value,
  onChange,
  isTrainingRunning,
  showTrainingView,
}: {
  value: TrainSubTab;
  onChange: (next: TrainSubTab) => void;
  isTrainingRunning: boolean;
  showTrainingView: boolean;
}): ReactElement {
  const t = useT();
  const items: ReadonlyArray<{
    value: TrainSubTab;
    label: string;
    disabled: boolean;
  }> = [
    {
      value: "configure",
      label: t("studio.tabs.configure"),
      disabled: isTrainingRunning,
    },
    {
      value: "current-run",
      label: t("studio.tabs.currentRun"),
      disabled: !showTrainingView,
    },
    { value: "history", label: t("studio.tabs.history"), disabled: false },
  ];
  return (
    <div
      role="tablist"
      className="flex items-center gap-6 text-[13px] tracking-nav"
    >
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative h-9 select-none transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:rounded-full after:bg-foreground after:transition-opacity",
              active
                ? "font-semibold text-foreground after:opacity-100"
                : "text-muted-foreground hover:text-foreground after:opacity-0",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function StudioPage(): ReactElement {
  const t = useT();
  useTrainingRuntimeLifecycle();
  useTrainingCacheReconciliation();
  const showTrainingView = useTrainingRuntimeStore(shouldShowTrainingView);
  const isTrainingRunning = useTrainingRuntimeStore(
    (state) => state.isTrainingRunning,
  );
  const currentJobId = useTrainingRuntimeStore((state) => state.jobId);
  const runtimeMessage = useTrainingRuntimeStore((state) => state.message);
  const isHydratingRuntime = useTrainingRuntimeStore(
    (state) => state.isHydrating,
  );
  const hasHydratedRuntime = useTrainingRuntimeStore(
    (state) => state.hasHydrated,
  );

  const config = useTrainingConfigStore(
    useShallow((s) => ({
      datasetSource: s.datasetSource,
      dataset: s.dataset,
      uploadedFile: s.uploadedFile,
      datasetSubset: s.datasetSubset,
      datasetSplit: s.datasetSplit,
      isVisionModel: s.isVisionModel,
      isDatasetImage: s.isDatasetImage,
    })),
  );
  const hfToken = useHfTokenStore((s) => s.token);
  const selectedModel = useTrainingConfigStore((s) => s.selectedModel);
  const ensureModelDefaultsLoaded = useTrainingConfigStore(
    (s) => s.ensureModelDefaultsLoaded,
  );
  const ensureDatasetChecked = useTrainingConfigStore(
    (s) => s.ensureDatasetChecked,
  );
  const dialogOpen = useDatasetPreviewDialogStore((s) => s.open);
  const dialogMode = useDatasetPreviewDialogStore((s) => s.mode);
  const dialogInitial = useDatasetPreviewDialogStore((s) => s.initialData);
  const closeDialog = useDatasetPreviewDialogStore((s) => s.close);

  const [requestedTab, setRequestedTab] = useState<TrainSubTab>("configure");
  const selectedHistoryRunId = useTrainingRuntimeStore(
    (s) => s.selectedHistoryRunId,
  );
  const setSelectedHistoryRunId = useTrainingRuntimeStore(
    (s) => s.setSelectedHistoryRunId,
  );

  const setCurrentRunViewActive = useTrainingRuntimeStore(
    (s) => s.setCurrentRunViewActive,
  );

  useEffect(() => {
    return () => setSelectedHistoryRunId(null);
  }, [setSelectedHistoryRunId]);

  // Auto-switch to "current-run" only while training runs; afterward honour
  // the user's clicked tab. If "current-run" has nothing to show, use
  // "configure".
  const activeTab: TrainSubTab =
    isTrainingRunning && requestedTab !== "history"
      ? "current-run"
      : requestedTab === "current-run" && !showTrainingView
        ? "configure"
        : requestedTab;

  // Mirror "Current Run" tab state into the store so the sidebar can highlight
  // the run this view refers to. Cleared on unmount (leaving the studio page).
  useEffect(() => {
    setCurrentRunViewActive(activeTab === "current-run");
    return () => setCurrentRunViewActive(false);
  }, [activeTab, setCurrentRunViewActive]);

  const { setPinned } = useSidebar();
  const pinSidebar = useCallback(() => setPinned(true), [setPinned]);

  const tourEnabled = hasHydratedRuntime && !isHydratingRuntime;
  const isConfigTour = activeTab === "configure";
  const baseTourSteps =
    activeTab === "current-run" ? studioTrainingTourSteps : studioTourSteps;
  // Inject onEnter for navbar-targeting steps so the sidebar expands during the tour.
  const tourSteps = useMemo(
    () =>
      baseTourSteps.map((step) =>
        step.target === "navbar" ? { ...step, onEnter: pinSidebar } : step,
      ),
    [baseTourSteps, pinSidebar],
  );
  const tour = useGuidedTourController({
    id: "studio",
    steps: tourSteps,
    enabled: tourEnabled,
  });

  const setTourOpen = tour.setOpen;
  useEffect(() => {
    setTourOpen(false);
  }, [activeTab, setTourOpen]);

  // When training auto-switches us to "current-run", persist that in
  // requestedTab so the user stays on results after training ends.
  useEffect(() => {
    if (
      isTrainingRunning &&
      requestedTab !== "history" &&
      requestedTab !== "current-run"
    ) {
      setRequestedTab("current-run");
      setSelectedHistoryRunId(null);
    }
  }, [isTrainingRunning, requestedTab]);

  // Selecting a run from the sidebar only sets selectedHistoryRunId; auto-switch
  // to the History tab so the main panel reflects the selection.
  useEffect(() => {
    if (selectedHistoryRunId && requestedTab !== "history") {
      setRequestedTab("history");
    }
  }, [selectedHistoryRunId, requestedTab]);

  useEffect(() => {
    ensureModelDefaultsLoaded();
    ensureDatasetChecked();
  }, [selectedModel, ensureModelDefaultsLoaded, ensureDatasetChecked]);

  function handleTabChange(value: TrainSubTab) {
    setRequestedTab(value);
    if (value !== "history") {
      setSelectedHistoryRunId(null);
    }
  }

  const subtitle = (() => {
    if (activeTab === "current-run")
      return runtimeMessage || t("studio.subtitles.trainingInProgress");
    if (activeTab === "history")
      return selectedHistoryRunId
        ? t("studio.subtitles.viewingPastRun")
        : t("studio.subtitles.viewPastRuns");
    return t("studio.subtitles.configure");
  })();

  const showTrainingHydrating = !hasHydratedRuntime && isHydratingRuntime;
  const showHistoryBack = activeTab === "history" && !!selectedHistoryRunId;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-5 pb-20 pt-8 sm:px-9 sm:pt-10">
        <header className="font-heading flex flex-col gap-5">
          <div className="flex flex-col gap-0.5">
            <h1 className="page-title-halo text-[30px] font-semibold leading-[1.04] tracking-[-0.028em] text-foreground sm:text-[34px]">
              {t("studio.routeTitle")}
            </h1>
            <p className="page-title-halo text-sm text-muted-foreground">
              {subtitle}
            </p>
          </div>
          {!showTrainingHydrating && (
            <div className="flex items-center gap-3 border-b border-border/60">
              {showHistoryBack && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-ml-1 rounded-full text-muted-foreground"
                  onClick={() => setSelectedHistoryRunId(null)}
                  aria-label={t("studio.backToHistory")}
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                </Button>
              )}
              <TrainSubNav
                value={activeTab}
                onChange={handleTabChange}
                isTrainingRunning={isTrainingRunning}
                showTrainingView={showTrainingView}
              />
            </div>
          )}
        </header>

        <div className="flex w-full flex-col gap-6">
          <GuidedTour {...tour.tourProps} celebrate={isConfigTour} />

          {showTrainingHydrating ? (
            <div className="rounded-2xl border border-border/60 p-8 text-sm text-muted-foreground">
              {t("studio.loadingRuntime")}
            </div>
          ) : activeTab === "configure" ? (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
              <div className="min-w-0">
                <TrainingWizard />
              </div>
              <div className="lg:sticky lg:top-6 lg:self-start">
                <RunPreviewCard startCta={<StartTrainingCta />} />
              </div>
            </div>
          ) : activeTab === "current-run" ? (
            <LiveTrainingView />
          ) : selectedHistoryRunId ? (
            <HistoricalTrainingView runId={selectedHistoryRunId} />
          ) : (
            <HistoryCardGrid
              onSelectRun={(runId) => {
                if (runId === currentJobId && isTrainingRunning) {
                  handleTabChange("current-run");
                } else {
                  setSelectedHistoryRunId(runId);
                }
              }}
              onResumeStarted={() => {
                setSelectedHistoryRunId(null);
                handleTabChange("current-run");
              }}
            />
          )}
        </div>

        <DatasetPreviewDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          datasetSource={config.datasetSource}
          datasetName={
            config.datasetSource === "huggingface"
              ? config.dataset
              : config.uploadedFile
          }
          hfToken={hfToken.trim() || null}
          datasetSubset={config.datasetSubset}
          datasetSplit={config.datasetSplit}
          mode={dialogMode}
          initialData={dialogInitial}
          isVlm={config.isVisionModel && config.isDatasetImage === true}
        />
      </div>
    </div>
  );
}
