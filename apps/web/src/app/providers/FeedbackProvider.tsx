import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type FeedbackType = "success" | "error" | "info";

type FeedbackToast = {
  id: string;
  type: FeedbackType;
  title: string;
  message?: string;
};

type PushToastInput = {
  type?: FeedbackType;
  title: string;
  message?: string;
};

type FeedbackContextValue = {
  toasts: FeedbackToast[];
  pushToast: (toast: PushToastInput) => void;
  dismissToast: (toastId: string) => void;
};

type FeedbackProviderProps = {
  children: ReactNode;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: FeedbackProviderProps) {
  const [toasts, setToasts] = useState<FeedbackToast[]>([]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((currentToasts) =>
      currentToasts.filter((toast) => toast.id !== toastId),
    );
  }, []);

  const pushToast = useCallback(
    (toast: PushToastInput) => {
      const nextToast: FeedbackToast = {
        id: createToastId(),
        type: toast.type ?? "info",
        title: toast.title,
        ...(toast.message ? { message: toast.message } : {}),
      };

      setToasts((currentToasts) => [...currentToasts.slice(-2), nextToast]);
      globalThis.setTimeout(() => {
        dismissToast(nextToast.id);
      }, 4200);
    },
    [dismissToast],
  );

  const value = useMemo<FeedbackContextValue>(
    () => ({
      toasts,
      pushToast,
      dismissToast,
    }),
    [dismissToast, pushToast, toasts],
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
          <button
            className={`feedback-toast feedback-toast--${toast.type}`}
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
            type="button"
          >
            <strong>{toast.title}</strong>
            {toast.message ? <span>{toast.message}</span> : null}
          </button>
        ))}
      </div>
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

function createToastId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
