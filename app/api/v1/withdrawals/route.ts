import { NextResponse } from "next/server";

export const runtime = "nodejs";

type WithdrawalStatus = "pending" | "processing" | "completed" | "failed";

type Withdrawal = {
  id: string;
  amount: number;
  destination: string;
  status: WithdrawalStatus;
  createdAt: string;
};

type CreateWithdrawalBody = {
  amount: number;
  destination: string;
};

const IDEMPOTENCY_HEADER = "idempotency-key";

declare const globalThis: {
  __withdrawals_store__?: Map<string, Withdrawal>;
  __withdrawals_idempotency__?: Map<string, string>;
} & typeof global;

const getStore = () => {
  if (!globalThis.__withdrawals_store__) {
    globalThis.__withdrawals_store__ = new Map();
  }
  return globalThis.__withdrawals_store__;
};

const getIdempotencyIndex = () => {
  if (!globalThis.__withdrawals_idempotency__) {
    globalThis.__withdrawals_idempotency__ = new Map();
  }
  return globalThis.__withdrawals_idempotency__;
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export async function POST(request: Request) {
  let body: CreateWithdrawalBody;

  try {
    body = (await request.json()) as CreateWithdrawalBody;
  } catch {
    return NextResponse.json(
      { message: "Некорректное тело запроса." },
      { status: 400 },
    );
  }

  const idempotencyKey =
    request.headers.get(IDEMPOTENCY_HEADER) ??
    request.headers.get(IDEMPOTENCY_HEADER.toLowerCase());

  if (!idempotencyKey) {
    return NextResponse.json(
      { message: "Отсутствует заголовок идемпотентности." },
      { status: 400 },
    );
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { message: "Сумма должна быть числом больше 0." },
      { status: 422 },
    );
  }

  const destination = String(body.destination ?? "").trim();
  if (!destination) {
    return NextResponse.json(
      { message: "Поле назначения обязательно для заполнения." },
      { status: 422 },
    );
  }

  const store = getStore();
  const idempotencyIndex = getIdempotencyIndex();

  const existingId = idempotencyIndex.get(idempotencyKey);
  if (existingId) {
    const existingWithdrawal = store.get(existingId);
    if (existingWithdrawal) {
      return NextResponse.json(
        {
          message:
            "Заявка с таким идентификатором уже была создана. Используйте обновление статуса для проверки её состояния.",
        },
        { status: 409 },
      );
    }
  }

  const id = createId();
  const now = new Date().toISOString();

  const withdrawal: Withdrawal = {
    id,
    amount,
    destination,
    status: "pending",
    createdAt: now,
  };

  store.set(id, withdrawal);
  idempotencyIndex.set(idempotencyKey, id);

  return NextResponse.json(
    {
      withdrawal,
    },
    { status: 201 },
  );
}

