import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWalletScores1781910000000 implements MigrationInterface {
  name = "AddWalletScores1781910000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "wallet_scores" (
        "address"              character varying(128)       NOT NULL,
        "pnl_90d"              numeric(38,18),
        "win_rate"             numeric(10,8),
        "profit_factor"        numeric(38,18),
        "specialization"       jsonb                        NOT NULL,
        "sample_size"          integer                      NOT NULL,
        "score"                numeric(10,6)                NOT NULL,
        "computed_at"          TIMESTAMP WITH TIME ZONE     NOT NULL,
        "internal_created_at"  TIMESTAMP WITH TIME ZONE     NOT NULL DEFAULT now(),
        "internal_updated_at"  TIMESTAMP WITH TIME ZONE     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallet_scores" PRIMARY KEY ("address")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "wallet_scores"`);
  }
}
