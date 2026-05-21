import { create } from "zustand";

import type {
  FeedbackToast,
  PushToastInput,
  RewardModalState,
  ShowRewardModalInput,
} from "./feedback.types";

type FeedbackStore = {
  toasts: FeedbackToast[];
  rewardModal: RewardModalState;
  pushToast: (toast: PushToastInput) => string;
  dismissToast: (toastId: string) => void;
  showRewardModal: (modal: ShowRewardModalInput) => void;
  closeRewardModal: () => void;
  clearFeedback: () => void;
};

const CLOSED_REWARD_MODAL: RewardModalState = {
  open: false,
  title: "",
  rewards: [],
  confirmLabel: "确认",
};

let fallbackToastId = 0;

export const useFeedbackStore = create<FeedbackStore>((set) => ({
  toasts: [],
  rewardModal: CLOSED_REWARD_MODAL,
  pushToast: (toast) => {
    const nextToast = createToast(toast);

    set((state) => ({
      toasts: [...state.toasts.slice(-2), nextToast],
    }));

    return nextToast.id;
  },
  dismissToast: (toastId) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== toastId),
    }));
  },
  showRewardModal: (modal) => {
    set({
      rewardModal: {
        open: true,
        title: modal.title,
        rewards: modal.rewards,
        confirmLabel: modal.confirmLabel ?? "确认",
        ...(modal.message ? { message: modal.message } : {}),
      },
    });
  },
  closeRewardModal: () => {
    set({ rewardModal: CLOSED_REWARD_MODAL });
  },
  clearFeedback: () => {
    set({
      toasts: [],
      rewardModal: CLOSED_REWARD_MODAL,
    });
  },
}));

function createToast(input: PushToastInput): FeedbackToast {
  return {
    id: createFeedbackId("toast"),
    type: input.type ?? "info",
    title: input.title,
    createdAt: Date.now(),
    ...(input.message ? { message: input.message } : {}),
  };
}

function createFeedbackId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  fallbackToastId += 1;
  return `${prefix}:${Date.now()}:${fallbackToastId}`;
}
