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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getStore();
  const withdrawal = store.get(id);

  if (!withdrawal) {
    return NextResponse.json(
      { message: "Заявка не найдена." },
      { status: 404 },
    );
  }

  return NextResponse.json({ withdrawal });
}

