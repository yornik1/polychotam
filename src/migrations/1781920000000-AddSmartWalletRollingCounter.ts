import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSmartWalletRollingCounter1781920000000 implements MigrationInterface {
  name = "AddSmartWalletRollingCounter1781920000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_wallets"
        ADD COLUMN "consecutive_low_winrate_days" integer NOT NULL DEFAULT 0,
        ADD COLUMN "last_winrate_check_date"      date
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_wallets"
        DROP COLUMN "consecutive_low_winrate_days",
        DROP COLUMN "last_winrate_check_date"
    `);
  }
}
