import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWalletTradeCount1775866200000 implements MigrationInterface {
  name = "AddWalletTradeCount1775866200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD COLUMN "trade_count" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "trade_count"`,
    );
  }
}
