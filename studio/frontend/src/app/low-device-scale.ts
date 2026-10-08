// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import {
  observeDevicePixelRatio,
  type PixelRatioSource,
} from "./window-layout-lifecycle.ts";

export const LOW_DEVICE_SCALE_ATTRIBUTE = "data-low-device-scale";

const COMPOSITED_SCROLLING_DEVICE_SCALE = 1.5;

type FlagRoot = {
  toggleAttribute: (name: string, force: boolean) => boolean;
  removeAttribute: (name: string) => void;
};

export function isLowDeviceScale(
  devicePixelRatio: number,
  interfaceZoom: number,
): boolean {
  const zoom = interfaceZoom > 0 ? interfaceZoom : 1;
  return devicePixelRatio / zoom < COMPOSITED_SCROLLING_DEVICE_SCALE;
}

export function watchLowDeviceScale(options: {
  source: PixelRatioSource;
  interfaceZoom: () => number;
  subscribeInterfaceZoom: (listener: () => void) => () => void;
  root: FlagRoot;
}): () => void {
  const { source, interfaceZoom, subscribeInterfaceZoom, root } = options;
  const sync = () => {
    root.toggleAttribute(
      LOW_DEVICE_SCALE_ATTRIBUTE,
      isLowDeviceScale(source.devicePixelRatio(), interfaceZoom()),
    );
  };
  sync();
  const stopRatio = observeDevicePixelRatio(source, sync);
  const stopZoom = subscribeInterfaceZoom(sync);
  return () => {
    stopRatio();
    stopZoom();
    root.removeAttribute(LOW_DEVICE_SCALE_ATTRIBUTE);
  };
}
