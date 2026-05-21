import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { ResultToast } from "@/features/feedback/components/ResultToast";
import { RewardModal } from "@/features/feedback/components/RewardModal";
import { useFeedbackStore } from "@/features/feedback/feedback.store";
import type {
  FeedbackContextValue,
  PushToastInput,
} from "@/features/feedback/feedback.types";

type FeedbackProviderProps = {
  children: ReactNode;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: FeedbackProviderProps) {
  const toasts = useFeedbackStore((state) => state.toasts);
  const rewardModal = useFeedbackStore((state) => state.rewardModal);
  const storePushToast = useFeedbackStore((state) => state.pushToast);
  const dismissToast = useFeedbackStore((state) => state.dismissToast);
  const showRewardModal = useFeedbackStore((state) => state.showRewardModal);
  const closeRewardModal = useFeedbackStore((state) => state.closeRewardModal);
  const clearFeedback = useFeedbackStore((state) => state.clearFeedback);

  const pushToast = useCallback(
    (toast: PushToastInput) => {
      const toastId = storePushToast(toast);

      globalThis.setTimeout(() => {
        dismissToast(toastId);
      }, 4200);
    },
    [dismissToast, storePushToast],
  );

  const value = useMemo<FeedbackContextValue>(
    () => ({
      toasts,
      rewardModal,
      pushToast,
      dismissToast,
      showRewardModal,
      closeRewardModal,
      clearFeedback,
    }),
    [
      clearFeedback,
      closeRewardModal,
      dismissToast,
      pushToast,
      rewardModal,
      showRewardModal,
      toasts,
    ],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div
        className="feedback-stack"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {toasts.map((toast) => (
          <ResultToast
            key={toast.id}
            toast={toast}
            onDismiss={dismissToast}
          />
        ))}
      </div>
      <RewardModal modal={rewardModal} onClose={closeRewardModal} />
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const value = useContext(FeedbackContext);

  if (!value) {
    throw new Error("useFeedback must be used inside FeedbackProvider.");
  }

  return value;
}
