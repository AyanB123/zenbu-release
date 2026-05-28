import { useEffect } from "react";
import posthog from "posthog-js";
import { useDb } from "@zenbujs/core/react";

const POSTHOG_KEY = "phc_nTqm2y7kfjSVNbeRzPckbZaeodDcnso9fdVpge8bBuB8";
const POSTHOG_HOST = "https://us.i.posthog.com";

type AnalyticsState = "uninitialized" | "active" | "opted-out";

let state: AnalyticsState = "uninitialized";

function init() {
  if (state !== "uninitialized") return;
  state = "active";

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "always",
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_feature_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
  });

  const platform =
    typeof navigator !== "undefined" ? navigator.platform : undefined;

  posthog.register({
    app: "zenbu",
    runtime: "electron-renderer",
    ...(platform ? { platform } : {}),
  });
}

function setEnabled(enabled: boolean) {
  if (enabled) {
    if (state === "uninitialized") {
      init();
      return;
    }
    if (state === "opted-out") {
      posthog.opt_in_capturing();
      state = "active";
    }
    return;
  }

  if (state === "uninitialized") {
    state = "opted-out";
    return;
  }
  if (state === "active") {
    posthog.opt_out_capturing();
    state = "opted-out";
  }
}

export function useAnalyticsSync() {
  const disableTelemetry = useDb(
    (root) => root.app.settings.disableTelemetry,
  );
  useEffect(() => {
    try {
      setEnabled(!disableTelemetry);
    } catch {
      // analytics must never break the app
    }
  }, [disableTelemetry]);
}
