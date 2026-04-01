import { Controller, Get, Inject } from "@nestjs/common";
import { MarketsResponseDto } from "./dto/markets-response.dto.js";
import { MarketsService } from "./markets.service.js";

@Controller("markets")
export class MarketsController {
  constructor(
    @Inject(MarketsService)
    private readonly marketsService: Pick<MarketsService, "getMarkets">
  ) {}

  @Get()
  getMarkets(): Promise<MarketsResponseDto> {
    return this.marketsService.getMarkets();
  }
}
