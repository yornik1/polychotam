import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { FollowedWallet } from "./followed-wallet.entity.js";
import { FollowedWalletsService } from "./followed-wallets.service.js";

describe("FollowedWalletsService", () => {
  let repo: {
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };
  let service: FollowedWalletsService;

  beforeEach(() => {
    repo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
      find: vi.fn().mockResolvedValue([]),
    };
    service = new FollowedWalletsService(repo as unknown as Repository<FollowedWallet>);
  });

  it("follow нормализует адрес в lowercase и делает upsert (идемпотентно)", async () => {
    await service.follow("0xABCdef");
    expect(repo.upsert).toHaveBeenCalledWith({ address: "0xabcdef" }, ["address"]);
  });

  it("follow с пустым адресом ничего не делает", async () => {
    await service.follow("   ");
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("unfollow удаляет по нормализованному адресу", async () => {
    await service.unfollow("0xABC");
    expect(repo.delete).toHaveBeenCalledWith({ address: "0xabc" });
  });

  it("isFollowed=true при count>0", async () => {
    repo.count.mockResolvedValue(1);
    expect(await service.isFollowed("0xAbc")).toBe(true);
    expect(repo.count).toHaveBeenCalledWith({ where: { address: "0xabc" } });
  });

  it("isFollowed=false при count=0", async () => {
    repo.count.mockResolvedValue(0);
    expect(await service.isFollowed("0xabc")).toBe(false);
  });

  it("isFollowed=false для пустого адреса без запроса", async () => {
    expect(await service.isFollowed("")).toBe(false);
    expect(repo.count).not.toHaveBeenCalled();
  });

  it("list возвращает адреса, новые первыми", async () => {
    repo.find.mockResolvedValue([{ address: "0xnew" }, { address: "0xold" }]);
    const result = await service.list();
    expect(result).toEqual(["0xnew", "0xold"]);
    expect(repo.find).toHaveBeenCalledWith({ order: { internal_created_at: "DESC" } });
  });
});
