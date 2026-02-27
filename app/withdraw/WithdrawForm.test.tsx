import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWithdrawStore } from "../store/withdrawStore";
import { WithdrawForm } from "./WithdrawForm";

describe("WithdrawForm", () => {
  beforeEach(() => {
    resetWithdrawStore();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fillValidForm = () => {
    const amountInput = screen.getByLabelText("Сумма") as HTMLInputElement;
    const destinationInput = screen.getByLabelText(
      "Назначение",
    ) as HTMLInputElement;
    const confirmCheckbox = screen.getByLabelText(
      /Я подтверждаю, что сумма/i,
    ) as HTMLInputElement;

    fireEvent.change(amountInput, { target: { value: "100" } });
    fireEvent.change(destinationInput, {
      target: { value: "test-destination" },
    });
    fireEvent.click(confirmCheckbox);
  };

  it("отправляет заявку (happy path)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        withdrawal: {
          id: "w_1",
          amount: 100,
          destination: "test-destination",
          status: "pending",
          createdAt: new Date().toISOString(),
        },
      }),
    });

    global.fetch = fetchMock;

    render(<WithdrawForm />);

    fillValidForm();

    const submitButton = screen.getByRole("button", { name: "Создать заявку" });
    expect(submitButton).toBeEnabled();

    fireEvent.click(submitButton);

    expect(submitButton).toBeDisabled();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.getByText(/Статус заявки/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/w_1/)).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("отображает ошибку API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        message: "Заявка с таким идентификатором уже существует.",
      }),
    });

    global.fetch = fetchMock;

    render(<WithdrawForm />);

    fillValidForm();

    const submitButton = screen.getByRole("button", { name: "Создать заявку" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/Заявка с таким идентификатором уже существует./i),
      ).toBeInTheDocument();
    });
  });

  it("защищает от двойного submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        withdrawal: {
          id: "w_double",
          amount: 100,
          destination: "test-destination",
          status: "pending",
          createdAt: new Date().toISOString(),
        },
      }),
    });

    global.fetch = fetchMock;

    render(<WithdrawForm />);

    fillValidForm();

    const submitButton = screen.getByRole("button", { name: "Создать заявку" });

    fireEvent.click(submitButton);

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

