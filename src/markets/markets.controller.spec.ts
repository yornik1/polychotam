import { BadGatewayException, ServiceUnavailableException } from "@nestjs/common";
import { MarketsResponseDto } from "./dto/markets-response.dto";
import { MarketsController } from "./markets.controller";

describe("MarketsController", () => {
  function createController() {
    const getMarkets = vi.fn<() => Promise<MarketsResponseDto>>();
    const marketsService = {
      getMarkets,
    };
    const controller = new MarketsController(marketsService);

    return { controller, getMarkets };
  }

  it("возвращает контракт markets response", async () => {
    const { controller, getMarkets } = createController();
    const response: MarketsResponseDto = {
      data: [
        {
          id: "market-1",
          slug: "btc-above-100k",
          question: "Will BTC be above $100k?",
          outcomes: ["YES", "NO"],
          active: true,
          closed: false,
          liquidity: 1500.5,
          volume24h: 120.2,
          endDate: "2026-12-31T23:59:59.000Z",
        },
      ],
      meta: {
        source: "polymarket",
        total: 1,
        fetchedAt: "2026-04-01T12:00:00.000Z",
      },
    };
    getMarkets.mockResolvedValue(response);

    const result = await controller.getMarkets();

    expect(getMarkets).toHaveBeenCalledTimes(1);
    expect(result).toEqual(response);
  });

  it("пробрасывает исключение сервиса без изменений", async () => {
    const { controller, getMarkets } = createController();
    const error = new ServiceUnavailableException("Polymarket временно недоступен");
    getMarkets.mockRejectedValue(error);

    await expect(controller.getMarkets()).rejects.toBe(error);
  });

  it("пробрасывает 502 исключение сервиса без изменений", async () => {
    const { controller, getMarkets } = createController();
    const error = new BadGatewayException("Polymarket вернул ошибку шлюза");
    getMarkets.mockRejectedValue(error);

    await expect(controller.getMarkets()).rejects.toBe(error);
  });
});
