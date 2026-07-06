// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function SelectablePickerItem({
  active,
  onSelect,
  children,
  className,
}: {
  active?: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active ?? false}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05]",
        active && "bg-foreground/[0.06]",
        className,
      )}
    >
      {children}
    </button>
  );
}
