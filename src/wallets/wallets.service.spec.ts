import { describe, it, expect, vi } from "vitest";
import { Repository } from "typeorm";
import { Wallet } from "./wallet.entity";
import { WalletsService } from "./wallets.service";

describe("WalletsService", () => {
  function createService() {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const repository = { upsert } as Pick<Repository<Wallet>, "upsert">;
    const service = new WalletsService(repository as Repository<Wallet>);
    return { service, upsert };
  }

  it("вызывает repository.upsert с conflictPaths address", async () => {
    const { service, upsert } = createService();
    const payload = {
      address: "0xabc",
      total_won: "10",
      total_lost: "2",
      win_rate: "0.5"
    };

    await service.upsert(payload);

    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, conflictPaths] = upsert.mock.calls[0]!;
    expect(conflictPaths).toEqual(["address"]);
    expect(row).toMatchObject({
      address: payload.address,
      total_won: payload.total_won,
      total_lost: payload.total_lost,
      win_rate: payload.win_rate
    });
    expect(row).toHaveProperty("internal_updated_at");
    expect(row.internal_updated_at).toBeInstanceOf(Date);
  });
});
