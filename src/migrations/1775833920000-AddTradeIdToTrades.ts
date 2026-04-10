import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTradeIdToTrades1775833920000 implements MigrationInterface {
  public readonly name = "AddTradeIdToTrades1775833920000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trades"
      ADD COLUMN "trade_id" character varying(256)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trades_trade_id"
      ON "trades" ("trade_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_trades_trade_id"`);
    await queryRunner.query(`
      ALTER TABLE "trades"
      DROP COLUMN "trade_id"
    `);
  }
}
