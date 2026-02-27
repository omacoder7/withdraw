import { create } from "zustand";

export type WithdrawStatus = "idle" | "loading" | "success" | "error";

export type Withdrawal = {
  id: string;
  amount: number;
  destination: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
};

type ErrorKind = "none" | "api" | "network";

type WithdrawState = {
  amount: string;
  destination: string;
  confirm: boolean;
  status: WithdrawStatus;
  errorMessage: string | null;
  errorKind: ErrorKind;
  lastWithdrawal: Withdrawal | null;
  lastIdempotencyKey: string | null;
  lastRequestAt: number | null;
};

type WithdrawActions = {
  setAmount: (value: string) => void;
  setDestination: (value: string) => void;
  setConfirm: (value: boolean) => void;
  resetError: () => void;
  startRequest: (idempotencyKey: string) => void;
  finishSuccess: (withdrawal: Withdrawal) => void;
  finishError: (kind: Exclude<ErrorKind, "none">, message: string) => void;
  clearStatus: () => void;
  restoreFromSnapshot: (snapshot: Partial<WithdrawState>) => void;
};

export type WithdrawStore = WithdrawState & WithdrawActions;

const initialState: WithdrawState = {
  amount: "",
  destination: "",
  confirm: false,
  status: "idle",
  errorMessage: null,
  errorKind: "none",
  lastWithdrawal: null,
  lastIdempotencyKey: null,
  lastRequestAt: null,
};

export const useWithdrawStore = create<WithdrawStore>((set) => ({
  ...initialState,
  setAmount: (value) => set({ amount: value }),
  setDestination: (value) => set({ destination: value }),
  setConfirm: (value) => set({ confirm: value }),
  resetError: () => set({ errorMessage: null, errorKind: "none" }),
  startRequest: (idempotencyKey) =>
    set({
      status: "loading",
      errorMessage: null,
      errorKind: "none",
      lastIdempotencyKey: idempotencyKey,
      lastRequestAt: Date.now(),
    }),
  finishSuccess: (withdrawal) =>
    set({
      status: "success",
      lastWithdrawal: withdrawal,
      errorMessage: null,
      errorKind: "none",
      lastIdempotencyKey: null,
      lastRequestAt: null,
    }),
  finishError: (kind, message) =>
    set({
      status: "error",
      errorKind: kind,
      errorMessage: message,
    }),
  clearStatus: () =>
    set({
      status: "idle",
      errorMessage: null,
      errorKind: "none",
    }),
  restoreFromSnapshot: (snapshot) =>
    set((prev) => ({
      ...prev,
      ...snapshot,
    })),
}));

export const resetWithdrawStore = () => {
  useWithdrawStore.setState({ ...initialState });
};

export const withdrawIsFormValid = (state: WithdrawState): boolean => {
  const amountNumber = Number(state.amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return false;
  }
  if (!state.destination.trim()) {
    return false;
  }
  if (!state.confirm) {
    return false;
  }
  return true;
};

