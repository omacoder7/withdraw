"use client";

import { FormEvent, useEffect, useMemo } from "react";
import {
  useWithdrawStore,
  withdrawIsFormValid,
  type Withdrawal,
} from "../store/withdrawStore";

const IDEMPOTENCY_HEADER = "Idempotency-Key";
const SNAPSHOT_KEY = "withdraw:last";
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

type SnapshotPayload = {
  state: {
    amount: string;
    destination: string;
    confirm: boolean;
  };
  withdrawal: Withdrawal | null;
  lastIdempotencyKey: string | null;
  lastRequestAt: number | null;
};

const isNetworkError = (error: unknown): boolean => {
  return error instanceof TypeError;
};

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

async function postWithdrawal(
  amount: number,
  destination: string,
  idempotencyKey: string,
): Promise<Withdrawal> {
  const response = await fetch("/api/v1/withdrawals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [IDEMPOTENCY_HEADER]: idempotencyKey,
    },
    body: JSON.stringify({ amount, destination }),
  });

  if (response.status === 409) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data?.message ??
        "Заявка с таким идентификатором уже создана. Пожалуйста, проверьте статус последней операции.",
    );
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data?.message ?? "Не удалось создать заявку на вывод средств.";
    throw new Error(message);
  }

  const data = (await response.json()) as { withdrawal: Withdrawal };
  return data.withdrawal;
}

async function getWithdrawal(id: string): Promise<Withdrawal> {
  const response = await fetch(`/api/v1/withdrawals/${id}`, {
    method: "GET",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data?.message ?? "Не удалось получить статус заявки на вывод средств.";
    throw new Error(message);
  }

  const data = (await response.json()) as { withdrawal: Withdrawal };
  return data.withdrawal;
}

export function WithdrawForm() {
  const {
    amount,
    destination,
    confirm,
    status,
    errorMessage,
    errorKind,
    lastWithdrawal,
    lastIdempotencyKey,
    lastRequestAt,
    setAmount,
    setDestination,
    setConfirm,
    resetError,
    startRequest,
    finishSuccess,
    finishError,
    restoreFromSnapshot,
  } = useWithdrawStore();

  const isValid = useWithdrawStore(withdrawIsFormValid);
  const isLoading = status === "loading";

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.sessionStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as SnapshotPayload;
      if (!parsed.lastRequestAt) return;

      const age = Date.now() - parsed.lastRequestAt;
      if (age > SNAPSHOT_TTL_MS) {
        window.sessionStorage.removeItem(SNAPSHOT_KEY);
        return;
      }

      restoreFromSnapshot({
        amount: parsed.state.amount,
        destination: parsed.state.destination,
        confirm: parsed.state.confirm,
        lastWithdrawal: parsed.withdrawal,
        lastIdempotencyKey: parsed.lastIdempotencyKey,
        lastRequestAt: parsed.lastRequestAt,
      });
    } catch {
      // ignore snapshot errors
    }
  }, [restoreFromSnapshot]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const snapshot: SnapshotPayload = {
      state: {
        amount,
        destination,
        confirm,
      },
      withdrawal: lastWithdrawal,
      lastIdempotencyKey,
      lastRequestAt,
    };

    try {
      window.sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore snapshot errors
    }
  }, [amount, destination, confirm, lastWithdrawal, lastIdempotencyKey, lastRequestAt]);

  const canSubmit = useMemo(
    () => isValid && !isLoading,
    [isValid, isLoading],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isLoading) return;

    resetError();

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      finishError("api", "Сумма должна быть больше 0.");
      return;
    }

    const idempotencyKey = lastIdempotencyKey ?? createIdempotencyKey();
    startRequest(idempotencyKey);

    try {
      const withdrawal = await postWithdrawal(
        numericAmount,
        destination.trim(),
        idempotencyKey,
      );
      finishSuccess(withdrawal);
    } catch (error) {
      if (isNetworkError(error)) {
        finishError(
          "network",
          "Сетевая ошибка. Проверьте подключение и повторите попытку.",
        );
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Произошла непредвиденная ошибка.";
      finishError("api", message);
    }
  };

  const handleRetry = async () => {
    if (isLoading) return;
    if (!lastIdempotencyKey) {
      return;
    }

    resetError();

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      finishError("api", "Сумма должна быть больше 0.");
      return;
    }

    startRequest(lastIdempotencyKey);

    try {
      const withdrawal = await postWithdrawal(
        numericAmount,
        destination.trim(),
        lastIdempotencyKey,
      );
      finishSuccess(withdrawal);
    } catch (error) {
      if (isNetworkError(error)) {
        finishError(
          "network",
          "Сетевая ошибка. Проверьте подключение и повторите попытку.",
        );
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Произошла непредвиденная ошибка.";
      finishError("api", message);
    }
  };

  const handleRefreshStatus = async () => {
    if (!lastWithdrawal || isLoading) return;

    resetError();
    try {
      const updated = await getWithdrawal(lastWithdrawal.id);
      finishSuccess(updated);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Не удалось обновить статус заявки.";
      finishError("api", message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-8 dark:bg-black">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-lg shadow-zinc-200 dark:bg-zinc-950 dark:shadow-black/40">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Withdraw
        </h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Создайте заявку на вывод средств. Перед подтверждением проверьте сумму
          и реквизиты назначения.
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          aria-label="Форма вывода средств"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="amount"
              className="block text-sm font-medium text-zinc-800 dark:text-zinc-100"
            >
              Сумма
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              min={0}
              step="0.0001"
              className="block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              required
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Укажите сумму вывода &gt; 0.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="destination"
              className="block text-sm font-medium text-zinc-800 dark:text-zinc-100"
            >
              Назначение
            </label>
            <input
              id="destination"
              name="destination"
              type="text"
              className="block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              required
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Реквизиты или адрес назначения, без секретных данных.
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
            <input
              id="confirm"
              name="confirm"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
              checked={confirm}
              onChange={(event) => setConfirm(event.target.checked)}
            />
            <span>
              Я подтверждаю, что сумма и реквизиты назначения указаны верно и
              понимаю риск безотзывного перевода.
            </span>
          </label>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
            >
              {errorMessage}
              {errorKind === "network" && (
                <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                  Данные формы сохранены. Вы можете повторить попытку без
                  повторного ввода.
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-zinc-400 disabled:text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 sm:w-auto"
            >
              {isLoading ? "Создание заявки..." : "Создать заявку"}
            </button>

            {errorKind === "network" && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={isLoading}
                className="inline-flex w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:w-auto"
              >
                Повторить запрос
              </button>
            )}
          </div>
        </form>

        <div className="mt-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <h2 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Статус заявки
          </h2>

          {status === "idle" && !lastWithdrawal && (
            <p className="text-sm text-zinc-500 dark:text-zinc-500">
              Заявка ещё не создана.
            </p>
          )}

          {status === "loading" && (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Отправляем запрос на создание заявки...
            </p>
          )}

          {lastWithdrawal && (
            <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800 ring-1 ring-zinc-100 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    ID заявки
                  </div>
                  <div className="font-mono text-xs">{lastWithdrawal.id}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Сумма
                  </div>
                  <div className="font-semibold">
                    {lastWithdrawal.amount.toString()}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Назначение:{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-200">
                  {lastWithdrawal.destination}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Текущий статус:{" "}
                  <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                    {lastWithdrawal.status}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshStatus}
                  disabled={isLoading}
                  className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Обновить статус
                </button>
              </div>
            </div>
          )}

          {status === "error" && !lastWithdrawal && !errorMessage && (
            <p className="text-sm text-red-700 dark:text-red-300">
              Произошла ошибка при создании заявки.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

