import type { WalletPnlSummary } from "../types/contracts";
import { WalletsController } from "./wallets.controller";

describe("WalletsController", () => {
  function summary(address = "0xabc"): WalletPnlSummary {
    return {
      address,
      method: "resolved_only_local_trades",
      period: { from: "2026-01-01T00:00:00.000Z", days: 30 },
      totalPnl: 6,
      totalRisk: 4,
      roi: 1.5,
      winRate: 1,
      includedTradeCount: 1,
      skippedTradeCount: 0,
      dataGaps: [],
      limitations: [],
    };
  }

  function createController() {
    const getHistoricalPnl = vi.fn<() => Promise<WalletPnlSummary>>();
    const walletsService = {
      getHistoricalPnl,
    };
    const controller = new WalletsController(walletsService);

    return { controller, getHistoricalPnl };
  }

  it("делегирует P&L с default периодом 30 дней", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-02-01T00:00:00.000Z").getTime(),
    );
    const { controller, getHistoricalPnl } = createController();
    getHistoricalPnl.mockResolvedValue(summary());

    const result = await controller.getWalletPnl("  0xabc  ");

    expect(result).toEqual(summary());
    expect(getHistoricalPnl).toHaveBeenCalledWith("0xabc", {
      days: 30,
      from: new Date("2026-01-02T00:00:00.000Z"),
    });
    nowSpy.mockRestore();
  });

  it("использует days из query", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-02-01T00:00:00.000Z").getTime(),
    );
    const { controller, getHistoricalPnl } = createController();
    getHistoricalPnl.mockResolvedValue(summary());

    await controller.getWalletPnl("0xabc", "7");

    expect(getHistoricalPnl).toHaveBeenCalledWith("0xabc", {
      days: 7,
      from: new Date("2026-01-25T00:00:00.000Z"),
    });
    nowSpy.mockRestore();
  });

  it("для invalid days возвращается к default 30", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-02-01T00:00:00.000Z").getTime(),
    );
    const { controller, getHistoricalPnl } = createController();
    getHistoricalPnl.mockResolvedValue(summary());

    await controller.getWalletPnl("0xabc", "oops");

    expect(getHistoricalPnl).toHaveBeenCalledWith("0xabc", {
      days: 30,
      from: new Date("2026-01-02T00:00:00.000Z"),
    });
    nowSpy.mockRestore();
  });

  it("слишком большой days ограничивает безопасным максимумом", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-02-01T00:00:00.000Z").getTime(),
    );
    const { controller, getHistoricalPnl } = createController();
    getHistoricalPnl.mockResolvedValue(summary());

    await controller.getWalletPnl("0xabc", "999999999999999999999");

    expect(getHistoricalPnl).toHaveBeenCalledWith("0xabc", {
      days: 30,
      from: new Date("2026-01-02T00:00:00.000Z"),
    });
    nowSpy.mockRestore();
  });
});
