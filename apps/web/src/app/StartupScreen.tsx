import { Gem, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../shared/ui/Button.tsx";

type StartupScreenProps = {
  title: string;
  message: string;
  failed?: boolean | undefined;
  retryLabel?: string | undefined;
  retryDisabled?: boolean | undefined;
  onRetry?: (() => void) | undefined;
};

export function StartupScreen({
  title,
  message,
  failed = false,
  retryLabel,
  retryDisabled = false,
  onRetry,
}: StartupScreenProps): ReactNode {
  return (
    <main className={`startup${failed ? " failed" : ""}`} aria-busy={!failed}>
      <img
        className="startup-art"
        src="/assets/startup/entry-gate.webp"
        alt=""
        aria-hidden="true"
      />

      <header className="startup-brand" aria-label="EvoMyPet">
        <img
          className="startup-emblem"
          src="/assets/startup/evomypet-emblem.png"
          alt=""
          aria-hidden="true"
        />
        <strong>EvoMyPet</strong>
      </header>

      <section
        className="startup-status"
        role={failed ? "alert" : "status"}
        aria-live={failed ? "assertive" : "polite"}
      >
        <h1>{title}</h1>
        <p>{message}</p>
        {!failed ? (
          <div className="startup-progress" aria-hidden="true">
            <Gem />
            <Gem />
            <Gem />
          </div>
        ) : null}
        {onRetry && retryLabel ? (
          <Button onClick={onRetry} disabled={retryDisabled}>
            <RotateCw className={retryDisabled ? "spin" : undefined} />
            {retryLabel}
          </Button>
        ) : null}
      </section>
    </main>
  );
}
