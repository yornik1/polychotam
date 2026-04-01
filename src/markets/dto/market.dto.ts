export interface MarketDto {
  id: string;
  slug: string;
  question: string;
  outcomes: string[];
  active: boolean;
  closed: boolean;
  liquidity: number;
  volume24h: number;
  endDate: string | null;
}
