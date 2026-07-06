// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { datasetDisplayName } from "@/features/dataset-picker";
import {
  looksLikeLocalPath,
  ownerOf,
  repoOf,
  useHfTokenStore,
} from "@/features/hub";
import {
  TRAINING_METHOD_META,
  useTrainingConfigStore,
  useTrainingReadiness,
  useTrainingResourceNotices,
} from "@/features/training";
import { useGpuInfo } from "@/hooks";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactElement, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

function formatLearningRate(lr: number): string {
  if (!Number.isFinite(lr) || lr === 0) return "0";
  return lr.toExponential().replace(/\.?0+e/, "e");
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11.5px] text-muted-foreground/85">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[12.5px] text-foreground/90",
          mono && "font-mono text-[12px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ResourceNoticeRow({
  label,
  status,
  description,
}: {
  label: string;
  status: "download" | "partial";
  description: string;
}): ReactElement {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3 text-[11.5px]">
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground/80">
        <Tooltip>
          <TooltipTrigger asChild={true}>
            <button
              type="button"
              aria-label={label}
              className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/50 leading-none transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
            >
              <HugeiconsIcon icon={InformationCircleIcon} className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] leading-relaxed">
            {description}
          </TooltipContent>
        </Tooltip>
        {label}
      </span>
      <span className="truncate text-right text-foreground/80">
        {status === "partial"
          ? t("studio.preview.continuesOnStart")
          : t("studio.preview.downloadsOnStart")}
      </span>
    </div>
  );
}

export function RunPreviewCard({
  startCta,
}: {
  startCta: ReactElement;
}): ReactElement {
  const t = useT();
  const {
    selectedModel,
    trainingMethod,
    datasetSource,
    dataset,
    uploadedFile,
    datasetSplit,
    maxSteps,
    epochs,
    batchSize,
    gradientAccumulation,
    learningRate,
    contextLength,
  } = useTrainingConfigStore(
    useShallow((s) => ({
      selectedModel: s.selectedModel,
      trainingMethod: s.trainingMethod,
      datasetSource: s.datasetSource,
      dataset: s.dataset,
      uploadedFile: s.uploadedFile,
      datasetSplit: s.datasetSplit,
      maxSteps: s.maxSteps,
      epochs: s.epochs,
      batchSize: s.batchSize,
      gradientAccumulation: s.gradientAccumulation,
      learningRate: s.learningRate,
      contextLength: s.contextLength,
    })),
  );

  const gpu = useGpuInfo();
  const hfToken = useHfTokenStore((s) => s.token);
  const hasToken = !!hfToken && hfToken.trim().length > 0;
  const { isReady, hasModel, hasDataset } = useTrainingReadiness();
  const resourceNotices = useTrainingResourceNotices();

  const modelIsLocal = !!selectedModel && looksLikeLocalPath(selectedModel);
  const modelOwner =
    selectedModel && !modelIsLocal ? ownerOf(selectedModel) : null;
  const modelName = selectedModel
    ? modelIsLocal
      ? datasetDisplayName(selectedModel)
      : repoOf(selectedModel)
    : null;
  const datasetName =
    datasetSource === "upload"
      ? uploadedFile
        ? datasetDisplayName(uploadedFile)
        : null
      : dataset
        ? repoOf(dataset)
        : null;
  const datasetOwner =
    hasDataset && datasetSource !== "upload" && dataset
      ? ownerOf(dataset)
      : null;
  const methodMeta = TRAINING_METHOD_META[trainingMethod];
  const lengthLabel =
    maxSteps && maxSteps > 0
      ? t("studio.preview.steps", { count: maxSteps.toLocaleString() })
      : t(epochs === 1 ? "studio.preview.epoch" : "studio.preview.epochs", {
          count: epochs,
        });
  const effectiveBatch = batchSize * gradientAccumulation;
  const showEffectiveBatch = gradientAccumulation > 1;

  return (
    <aside
      className={cn(
        "elevated-card flex flex-col gap-7 bg-foreground/[0.012] p-6",
        "dark:bg-white/[0.018]",
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium tracking-nav text-muted-foreground">
          {t("studio.preview.title")}
        </h2>
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium tracking-nav",
            isReady
              ? "bg-foreground/[0.06] text-foreground/90 dark:bg-white/[0.08]"
              : "bg-foreground/[0.03] text-muted-foreground/70 dark:bg-white/[0.04]",
          )}
        >
          {isReady ? t("studio.preview.ready") : t("studio.preview.notReady")}
        </span>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          {modelOwner && (
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-muted-foreground/70">
              {modelOwner}
            </p>
          )}
          <p
            className={cn(
              "break-words font-heading text-[20px] font-semibold leading-[1.2] tracking-[-0.018em]",
              hasModel ? "text-foreground" : "text-muted-foreground/60",
            )}
            title={selectedModel ?? undefined}
          >
            {modelName ?? t("studio.preview.modelPending")}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          {datasetOwner && (
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-muted-foreground/70">
              {datasetOwner}
            </p>
          )}
          <p
            className={cn(
              "truncate font-mono text-[12px]",
              hasDataset ? "text-foreground/80" : "text-muted-foreground/55",
            )}
            title={
              datasetSource === "upload"
                ? (uploadedFile ?? undefined)
                : (dataset ?? undefined)
            }
          >
            {datasetName ?? t("studio.preview.datasetPending")}
            {hasDataset && datasetSource !== "upload" && datasetSplit ? (
              <span className="text-muted-foreground/70">
                {" "}
                · {datasetSplit}
              </span>
            ) : null}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <MetaRow
          label={t("studio.preview.method")}
          value={
            <>
              {t(methodMeta.labelKey)}
              <span className="ml-1.5 text-muted-foreground/70">
                · {t(methodMeta.noteKey)}
              </span>
            </>
          }
        />
        <MetaRow label={t("studio.preview.length")} value={lengthLabel} />
        <MetaRow
          label={t("studio.preview.batch")}
          value={
            showEffectiveBatch ? (
              <>
                <span className="font-mono">{batchSize}</span>
                <span className="text-muted-foreground/70"> × </span>
                <span className="font-mono">{gradientAccumulation}</span>
                <span className="text-muted-foreground/70">
                  {" "}
                  = {effectiveBatch}
                </span>
              </>
            ) : (
              <span className="font-mono">{batchSize}</span>
            )
          }
        />
        <MetaRow
          label={t("studio.preview.context")}
          value={contextLength.toLocaleString()}
          mono={true}
        />
        <MetaRow
          label={t("studio.preview.lr")}
          value={formatLearningRate(learningRate)}
          mono={true}
        />
      </section>

      <section className="flex flex-col gap-3">
        <MetaRow
          label={t("studio.preview.hardware")}
          value={
            gpu.available
              ? `${gpu.name} · ${gpu.memoryTotalGb} GB`
              : t("studio.preview.noGpu")
          }
        />
        <MetaRow
          label={t("studio.preview.hfToken")}
          value={
            hasToken
              ? t("studio.preview.connected")
              : t("studio.preview.notSet")
          }
        />
      </section>

      {resourceNotices.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-muted-foreground/60">
            {t("studio.preview.files")}
          </p>
          {resourceNotices.map((notice) => (
            <ResourceNoticeRow
              key={`${notice.kind}:${notice.status}:${notice.id}`}
              label={
                notice.kind === "model"
                  ? t("studio.preview.model")
                  : t("studio.preview.dataset")
              }
              status={notice.status}
              description={t(
                notice.kind === "model"
                  ? notice.status === "partial"
                    ? "studio.preview.noticeModelPartial"
                    : "studio.preview.noticeModelDownload"
                  : notice.status === "partial"
                    ? "studio.preview.noticeDatasetPartial"
                    : "studio.preview.noticeDatasetDownload",
              )}
            />
          ))}
        </section>
      )}

      <div className="-mx-6 h-px bg-foreground/[0.07] dark:bg-white/[0.06]" />

      <div className="-mt-2">{startCta}</div>
    </aside>
  );
}
