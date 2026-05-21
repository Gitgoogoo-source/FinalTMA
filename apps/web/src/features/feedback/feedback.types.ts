export type FeedbackToastType = "success" | "error" | "info";

export type FeedbackToast = {
  id: string;
  type: FeedbackToastType;
  title: string;
  message?: string;
  createdAt: number;
};

export type PushToastInput = {
  type?: FeedbackToastType;
  title: string;
  message?: string;
};

export type RewardModalItemTone = "item" | "kcoin" | "fgems" | "stars";

export type RewardModalItem = {
  id?: string;
  label: string;
  amount?: string | number;
  detail?: string;
  imageUrl?: string | null;
  tone?: RewardModalItemTone;
};

export type RewardModalState = {
  open: boolean;
  title: string;
  message?: string;
  rewards: RewardModalItem[];
  confirmLabel: string;
};

export type ShowRewardModalInput = {
  title: string;
  message?: string;
  rewards: RewardModalItem[];
  confirmLabel?: string;
};

export type FeedbackContextValue = {
  toasts: FeedbackToast[];
  rewardModal: RewardModalState;
  pushToast: (toast: PushToastInput) => void;
  dismissToast: (toastId: string) => void;
  showRewardModal: (modal: ShowRewardModalInput) => void;
  closeRewardModal: () => void;
  clearFeedback: () => void;
};
