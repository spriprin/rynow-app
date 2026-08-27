"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import type { Ref } from "react";

export type AuthTurnstileHandle = TurnstileInstance;

export function getTurnstileSiteKey() {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";
}

export function isTurnstileConfigured() {
  return Boolean(getTurnstileSiteKey());
}

export function AuthTurnstile({
  action,
  instanceRef,
  onSuccess,
  onExpire,
  onError,
}: {
  action: string;
  instanceRef?: Ref<TurnstileInstance | undefined>;
  onSuccess: (token: string) => void;
  onExpire: () => void;
  onError: () => void;
}) {
  const siteKey = getTurnstileSiteKey();
  if (!siteKey) return null;

  return (
    <div className="auth-turnstile" aria-label="Security check">
      <Turnstile
        ref={instanceRef}
        siteKey={siteKey}
        onSuccess={onSuccess}
        onExpire={onExpire}
        onTimeout={onExpire}
        onError={() => onError()}
        onUnsupported={() => onError()}
        options={{
          action,
          appearance: "interaction-only",
          execution: "render",
          refreshExpired: "auto",
          refreshTimeout: "auto",
          size: "flexible",
          theme: "light",
        }}
      />
    </div>
  );
}
