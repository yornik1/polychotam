import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSmartWalletsTable1778578400000 implements MigrationInterface {
  name = "AddSmartWalletsTable1778578400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "smart_wallets" (
        "address" character varying(128) NOT NULL,
        "notes" text NOT NULL DEFAULT '',
        "active" boolean NOT NULL DEFAULT true,
        "hit_rate" numeric(10,6),
        "sum_pnl" numeric(38,18),
        "roi_pct" numeric(10,4),
        "whale_trade_count" integer NOT NULL DEFAULT 0,
        "source" character varying(32) NOT NULL DEFAULT 'manual',
        "internal_created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "internal_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_wallets_address" PRIMARY KEY ("address")
      )
    `);

    // Seed с 6 адресами из research iteration 3
    await queryRunner.query(`
      INSERT INTO "smart_wallets" (address, hit_rate, sum_pnl, roi_pct, whale_trade_count, source, notes) VALUES
      ('0x5d58e38cd0a7e6f5fa67b7f9c2f70dd70df09a15', 0.700000, 723988.98, 25.7260, 10, 'research', 'Top ROI 25.7%, research iteration 3'),
      ('0x241f846866c2de4fb67cdb0ca6b963d85e56ef50', 1.000000, 7130.05, 0.1565, 207, 'research', 'HR 100% но ROI 0.15% — возможно MM/arb'),
      ('0xa53c26443fb636d8ae31ac24f62fc1d5ef8f67a5', 0.814300, 4636.61, 0.0546, 237, 'research', 'HR 81%, много trades, низкий ROI'),
      ('0xf9c1190aa8184bcbe418e6f5321c53b0bfbc39e2', 0.727300, 3314.09, 1.2487, 11, 'research', 'ROI 1.25%, 11 trades'),
      ('0xccc1afdec8b8a8d7770eeabc0041b610c621889d', 0.952400, 662.25, 0.0795, 21, 'research', 'HR 95%, micro PnL'),
      ('0xc8ab97a9089a9ff7e6ef0688e6e591a066946418', 0.636400, 474.76, 0.0936, 11, 'research', 'HR 64%, 11 trades')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "smart_wallets"`);
  }
}
