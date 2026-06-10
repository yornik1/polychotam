import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWalletPnlSnapshots1781069316384 implements MigrationInterface {
  name = "AddWalletPnlSnapshots1781069316384";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "wallet_pnl_snapshots" (
        "address"              character varying(128)       NOT NULL,
        "window"               character varying(8)         NOT NULL,
        "pnl"                  numeric(38,18)               NOT NULL,
        "realized_pnl"         numeric(38,18)               NOT NULL,
        "open_positions_value" numeric(38,18)               NOT NULL,
        "by_operation"         jsonb                        NOT NULL,
        "last_watermark_ts"    bigint,
        "boundary_ids"         jsonb                        NOT NULL,
        "hypothesis_types"     jsonb                        NOT NULL,
        "data_gaps"            jsonb                        NOT NULL,
        "validated"            boolean                      NOT NULL DEFAULT false,
        "computed_at"          TIMESTAMP WITH TIME ZONE     NOT NULL,
        "internal_created_at"  TIMESTAMP WITH TIME ZONE     NOT NULL DEFAULT now(),
        "internal_updated_at"  TIMESTAMP WITH TIME ZONE     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallet_pnl_snapshots" PRIMARY KEY ("address", "window")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "wallet_pnl_snapshots"`);
  }
}
