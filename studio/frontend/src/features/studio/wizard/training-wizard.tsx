// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HfTokenIndicator } from "@/features/hub";
import {
  TRAIN_PICKER_TRIGGER_CLASS,
  TrainModelSelector,
} from "@/features/model-picker";
import {
  TRAINING_METHOD_META,
  TRAINING_METHOD_ORDER,
  parseYamlConfig,
  serializeConfigToYaml,
  useTrainingActions,
  useTrainingConfigStore,
  useTrainingReadiness,
} from "@/features/training";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { DatasetSource, TrainingMethod } from "@/types/training";
import {
  Archive04Icon,
  BrainIcon,
  CleanIcon,
  CloudUploadIcon,
  Database02Icon,
  FloppyDiskIcon,
  Rocket01Icon,
  Settings05Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { DatasetPanel } from "../sections/dataset-section";
import { ParamsSection } from "../sections/params-section";

function SectionBox({
  title,
  description,
  icon,
  iconColor,
  titleAction,
  children,
  dataTour,
}: {
  title?: string;
  description?: string;
  icon?: IconSvgElement;
  iconColor?: string;
  titleAction?: ReactNode;
  children: ReactNode;
  dataTour?: string;
}) {
  return (
    <section
      data-tour={dataTour}
      className="elevated-card flex flex-col gap-4 bg-card p-5"
    >
      {title && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {icon && (
              <span
                className="train-section-chip inline-flex size-9 shrink-0 items-center justify-center rounded-full"
                style={
                  iconColor
                    ? ({ "--chip-color": iconColor } as CSSProperties)
                    : undefined
                }
              >
                <HugeiconsIcon
                  icon={icon}
                  strokeWidth={1.5}
                  className="size-[18px]"
                />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="select-none text-[13.5px] font-semibold leading-[18px] tracking-[-0.012em] text-foreground">
                {title}
              </h3>
              {description && (
                <p className="text-[11.5px] leading-[15px] text-muted-foreground/85">
                  {description}
                </p>
              )}
            </div>
          </div>
          {titleAction && <div className="shrink-0">{titleAction}</div>}
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </section>
  );
}

type ParamMode = "simple" | "advanced";

const PARAM_MODE_KEY = "unsloth_train_param_mode";

function readParamMode(): ParamMode {
  if (typeof window === "undefined") return "simple";
  try {
    return window.localStorage.getItem(PARAM_MODE_KEY) === "advanced"
      ? "advanced"
      : "simple";
  } catch {
    return "simple";
  }
}

function useParamMode(): [ParamMode, (next: ParamMode) => void] {
  const [mode, setMode] = useState<ParamMode>(readParamMode);
  const update = useCallback((next: ParamMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(PARAM_MODE_KEY, next);
    } catch {
      void 0;
    }
  }, []);
  return [mode, update];
}

function ParamModeToggle({
  mode,
  onChange,
}: {
  mode: ParamMode;
  onChange: (next: ParamMode) => void;
}) {
  const t = useT();
  return (
    <div
      role="tablist"
      aria-label={t("studio.params.mode.ariaLabel")}
      className="hub-menu-trigger hub-tab-toggle relative inline-flex h-8 w-[170px] shrink-0 items-center rounded-full"
    >
      <span
        aria-hidden="true"
        className={cn(
          "hub-tab-toggle-pill pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-full transition-transform duration-200 ease-out",
          mode === "advanced" ? "translate-x-full" : "translate-x-0",
        )}
      />
      {(["simple", "advanced"] as const).map((value) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(value)}
            className={cn(
              "relative z-10 inline-flex h-8 flex-1 items-center justify-center rounded-full px-3 text-[12.5px] transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(
              value === "simple"
                ? "studio.params.mode.simple"
                : "studio.params.mode.advanced",
            )}
          </button>
        );
      })}
    </div>
  );
}

function SetupField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground/70">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TrainingMethodSelect() {
  const t = useT();
  const trainingMethod = useTrainingConfigStore((s) => s.trainingMethod);
  const setTrainingMethod = useTrainingConfigStore((s) => s.setTrainingMethod);
  const activeMeta = TRAINING_METHOD_META[trainingMethod];
  return (
    <Select
      value={trainingMethod}
      onValueChange={(v) => setTrainingMethod(v as TrainingMethod)}
    >
      <SelectTrigger
        className={cn(
          TRAIN_PICKER_TRIGGER_CLASS,
          "w-full min-w-[148px] justify-between",
        )}
        data-tour="studio-method"
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              activeMeta?.dotClass ?? "bg-muted-foreground",
            )}
          />
          <span className="truncate font-medium text-foreground">
            {activeMeta ? t(activeMeta.labelKey) : trainingMethod}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent
        position="popper"
        side="bottom"
        align="start"
        sideOffset={8}
        avoidCollisions={false}
        className="rounded-[14px] ring-0"
      >
        {TRAINING_METHOD_ORDER.map((method) => {
          const meta = TRAINING_METHOD_META[method];
          return (
            <Tooltip key={method} delayDuration={300}>
              <TooltipTrigger asChild={true}>
                <SelectItem value={method}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        meta.dotClass,
                      )}
                    />
                    {t(meta.labelKey)}
                  </span>
                </SelectItem>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={10}
                className="max-w-[220px] text-[11.5px] leading-snug"
              >
                {t(meta.hintKey)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function ModelPanel() {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_200px]">
      <div className="sm:col-span-2 xl:col-span-1">
        <SetupField label={t("studio.wizard.modelLabel")}>
          <TrainModelSelector />
        </SetupField>
      </div>
      <SetupField label={t("studio.wizard.methodLabel")}>
        <TrainingMethodSelect />
      </SetupField>
      <SetupField label={t("studio.wizard.hfTokenLabel")}>
        <HfTokenIndicator showLabel={true} />
      </SetupField>
    </div>
  );
}

function resolveStartTrainingError(input: {
  t: ReturnType<typeof useT>;
  startError: string | null | undefined;
  isIncompatible: boolean;
  isAudioModel: boolean;
  isDatasetAudio: boolean | null | undefined;
  datasetUnverified: boolean;
  hasModel: boolean;
  hasDataset: boolean;
  datasetSource: DatasetSource;
  configValidation: { ok: boolean; message?: string | null };
}): string | null {
  const {
    t,
    startError,
    isIncompatible,
    isAudioModel,
    isDatasetAudio,
    datasetUnverified,
    hasModel,
    hasDataset,
    datasetSource,
    configValidation,
  } = input;
  if (startError) return startError;
  if (isIncompatible) {
    return !isAudioModel && isDatasetAudio === true
      ? t("studio.training.audioIncompatible")
      : t("studio.training.visionIncompatible");
  }
  if (datasetUnverified) {
    return t("studio.training.datasetUnverified");
  }
  if (!hasModel) return null;
  if (!hasDataset) {
    // S3 is configured through an inline form, so its validation guidance
    // ("Enter an S3 bucket name first." etc.) is actionable and should show
    // once a model is chosen. For HF/upload sources an empty dataset just means
    // the user hasn't picked yet, so stay silent — the button label prompts them.
    if (
      datasetSource === "s3" &&
      !configValidation.ok &&
      configValidation.message
    ) {
      return configValidation.message;
    }
    return null;
  }
  if (!configValidation.ok && configValidation.message) {
    return configValidation.message;
  }
  return null;
}

export function StartTrainingCta() {
  const t = useT();
  const { isAudioModel, isDatasetAudio, datasetSource } = useTrainingConfigStore(
    useShallow((s) => ({
      isAudioModel: s.isAudioModel,
      isDatasetAudio: s.isDatasetAudio,
      datasetSource: s.datasetSource,
    })),
  );
  const {
    isReady,
    isLoadingModel,
    isCheckingDataset,
    isIncompatible,
    datasetUnverified,
    hasModel,
    hasDataset,
    configValidation,
  } = useTrainingReadiness();
  const { isStarting, startError, startTrainingRun } = useTrainingActions();

  const disabled = isStarting || !isReady;

  const buttonLabel = isStarting
    ? t("studio.training.starting")
    : isLoadingModel
      ? t("studio.training.loadingModel")
      : isCheckingDataset
        ? t("studio.training.checkingDataset")
        : !hasModel && !hasDataset
          ? t("studio.training.chooseModelAndDataset")
          : hasModel
            ? hasDataset
              ? t("studio.training.startTraining")
              : t("studio.training.chooseDataset")
            : t("studio.training.chooseModel");

  const errorMessage = resolveStartTrainingError({
    t,
    startError,
    isIncompatible,
    isAudioModel,
    isDatasetAudio,
    datasetUnverified,
    hasModel,
    hasDataset,
    datasetSource,
    configValidation,
  });
  const isDatasetWarning = !startError && !isIncompatible && datasetUnverified;

  return (
    <div className="flex flex-col gap-2">
      <Button
        data-tour="studio-start"
        size="lg"
        className={cn(
          "h-11 w-full justify-center rounded-xl text-[13.5px] font-semibold tracking-tight",
          "bg-primary text-primary-foreground shadow-sm",
          "hover:bg-primary/90",
          "disabled:bg-foreground/[0.08] disabled:text-muted-foreground disabled:shadow-none dark:disabled:bg-white/[0.06]",
          "transition-colors duration-200",
        )}
        onClick={() => void startTrainingRun()}
        disabled={disabled}
      >
        <HugeiconsIcon
          icon={Rocket01Icon}
          strokeWidth={1.75}
          className="size-4"
        />
        {buttonLabel}
      </Button>
      {errorMessage && (
        <p
          className={cn(
            "text-[11.5px] leading-relaxed",
            isDatasetWarning ? "text-status-warning" : "text-destructive",
          )}
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}

function ConfigActions() {
  const t = useT();
  const selectedModel = useTrainingConfigStore((s) => s.selectedModel);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const config = parseYamlConfig(reader.result as string);
        useTrainingConfigStore.getState().applyConfigPatch(config);
        toast.success(t("studio.training.configLoaded"), {
          description: file.name,
        });
      } catch (err) {
        toast.error(t("studio.training.failedToLoadConfig"), {
          description:
            err instanceof Error
              ? err.message
              : t("studio.training.invalidYamlFile"),
        });
      }
    };
    reader.onerror = () => {
      toast.error(t("studio.training.failedToReadFile"));
    };
    reader.readAsText(file);
  };

  const handleSaveConfig = () => {
    const state = useTrainingConfigStore.getState();
    const includeVisionFields =
      state.isVisionModel && state.isDatasetImage !== false;
    const selectedModelLower = (state.selectedModel ?? "").toLowerCase();
    const isDeepseekOcr =
      selectedModelLower.includes("deepseek") &&
      selectedModelLower.includes("ocr");
    const yamlStr = serializeConfigToYaml(
      state,
      includeVisionFields,
      includeVisionFields && !isDeepseekOcr,
    );
    const blob = new Blob([yamlStr], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const model = (state.selectedModel ?? "model").split("/").pop();
    const method = state.trainingMethod ?? "qlora";
    const dataset = (state.dataset ?? "dataset").split("/").pop();
    const timestamp = new Date()
      .toISOString()
      .replace(/[:T]/g, "-")
      .slice(0, 19);
    a.download = `${model}_${method}_${dataset}_${timestamp}.yaml`;

    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResetConfig = () => {
    useTrainingConfigStore.getState().resetToModelDefaults();
    toast.success(t("studio.training.parametersReset"));
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Tooltip>
        <TooltipTrigger asChild={true}>
          <Button
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-lg"
            onClick={() => fileInputRef.current?.click()}
          >
            <HugeiconsIcon icon={CloudUploadIcon} className="size-3.5" />
            {t("studio.wizard.loadYaml")}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("studio.training.uploadConfigTooltip")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild={true}>
          <Button
            data-tour="studio-save"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-lg"
            onClick={handleSaveConfig}
          >
            <HugeiconsIcon icon={Archive04Icon} className="size-3.5" />
            {t("studio.wizard.saveYaml")}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("studio.training.saveConfigTooltip")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild={true}>
          <Button
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-lg"
            onClick={handleResetConfig}
            disabled={!selectedModel}
          >
            <HugeiconsIcon icon={CleanIcon} className="size-3.5" />
            {t("studio.wizard.resetDefaults")}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("studio.training.resetConfigTooltip")}
        </TooltipContent>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml"
        className="hidden"
        onChange={handleFileUpload}
      />
    </div>
  );
}

export function TrainingWizard() {
  const t = useT();
  const [paramMode, setParamMode] = useParamMode();
  return (
    <div className="flex flex-col gap-5">
      <SectionBox
        title={t("studio.wizard.modelTitle")}
        description={t("studio.wizard.modelDescription")}
        icon={BrainIcon}
        iconColor="#7abf85"
        dataTour="studio-model"
      >
        <ModelPanel />
      </SectionBox>

      <SectionBox
        title={t("studio.wizard.datasetTitle")}
        description={t("studio.wizard.datasetDescription")}
        icon={Database02Icon}
        iconColor="#e7828c"
        dataTour="studio-dataset"
      >
        <DatasetPanel />
      </SectionBox>

      <SectionBox
        title={t("studio.wizard.paramsTitle")}
        description={t("studio.wizard.paramsDescription")}
        icon={Settings05Icon}
        iconColor="#8a7cce"
        dataTour="studio-params"
        titleAction={
          <ParamModeToggle mode={paramMode} onChange={setParamMode} />
        }
      >
        <ParamsSection mode={paramMode} />
      </SectionBox>

      <SectionBox
        title={t("studio.wizard.configTitle")}
        description={t("studio.wizard.configDescription")}
        icon={FloppyDiskIcon}
        iconColor="#6ab7be"
      >
        <ConfigActions />
      </SectionBox>
    </div>
  );
}
