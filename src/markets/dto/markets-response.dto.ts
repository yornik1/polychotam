import { MarketDto } from "./market.dto";

export interface MarketsResponseDto {
  data: MarketDto[];
  meta: {
    source: "polymarket";
    total: number;
    fetchedAt: string;
  };
}
