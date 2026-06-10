import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMarketCategory1781900000000 implements MigrationInterface {
  name = "AddMarketCategory1781900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "markets"
      ADD COLUMN "category" character varying(32)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "markets"
      DROP COLUMN "category"
    `);
  }
}
