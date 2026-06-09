import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import type { WalletPnlSummary } from "../types/contracts.js";
import { resolveWalletPnlPeriod } from "./wallet-pnl-period.util.js";
import { WalletsService } from "./wallets.service.js";

@Controller("wallets")
export class WalletsController {
  constructor(
    @Inject(WalletsService)
    private readonly walletsService: Pick<WalletsService, "getHistoricalPnl">,
  ) {}

  @Get(":address/pnl")
  getWalletPnl(
    @Param("address") address: string,
    @Query("days") daysRaw?: string,
  ): Promise<WalletPnlSummary> {
    const period = resolveWalletPnlPeriod(daysRaw);
    return this.walletsService.getHistoricalPnl(address.trim(), {
      days: period.days,
      from: period.from,
    });
  }
}
