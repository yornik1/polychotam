import { MigrationInterface, QueryRunner } from "typeorm";

export class PolymarketCoreEntities1775052800149 implements MigrationInterface {
  public readonly name = "PolymarketCoreEntities1775052800149";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "markets" (
        "condition_id" character varying(128) NOT NULL,
        "question" text NOT NULL,
        "market_slug" character varying(512) NOT NULL,
        "tokens" jsonb NOT NULL,
        "active" boolean NOT NULL,
        "closed" boolean NOT NULL,
        "accepting_orders" boolean,
        "liquidity" double precision NOT NULL DEFAULT 0,
        "volume24hr" double precision NOT NULL DEFAULT 0,
        "end_date_iso" text,
        "internal_synced_at" TIMESTAMPTZ,
        "internal_created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "internal_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_markets_condition_id" PRIMARY KEY ("condition_id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_9c8c9b7a_market_slug" ON "markets" ("market_slug")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_markets_active_closed" ON "markets" ("active", "closed")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_markets_end_date_iso" ON "markets" ("end_date_iso")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_markets_volume24hr" ON "markets" ("volume24hr")`
    );

    await queryRunner.query(`
      CREATE TABLE "trades" (
        "id" character varying(256) NOT NULL,
        "taker_order_id" character varying(256) NOT NULL,
        "market" character varying(128) NOT NULL,
        "asset_id" character varying(256) NOT NULL,
        "side" character varying(8) NOT NULL,
        "size" character varying(128) NOT NULL,
        "fee_rate_bps" character varying(64) NOT NULL,
        "price" character varying(128) NOT NULL,
        "status" character varying(64) NOT NULL,
        "match_time" TIMESTAMPTZ NOT NULL,
        "last_update" TIMESTAMPTZ NOT NULL,
        "outcome" character varying(256) NOT NULL,
        "bucket_index" integer NOT NULL,
        "owner" character varying(128) NOT NULL,
        "maker_address" character varying(128) NOT NULL,
        "maker_orders" jsonb NOT NULL,
        "transaction_hash" character varying(128) NOT NULL,
        "trader_side" character varying(16) NOT NULL,
        CONSTRAINT "PK_trades_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trades_market" FOREIGN KEY ("market") REFERENCES "markets" ("condition_id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_trades_market_match_time" ON "trades" ("market", "match_time")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trades_owner_match_time" ON "trades" ("owner", "match_time")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trades_maker_address_match_time" ON "trades" ("maker_address", "match_time")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_trades_asset_id_match_time" ON "trades" ("asset_id", "match_time")`
    );

    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "address" character varying(128) NOT NULL,
        "total_won" numeric(38,18) NOT NULL DEFAULT 0,
        "total_lost" numeric(38,18) NOT NULL DEFAULT 0,
        "win_rate" numeric(10,6) NOT NULL DEFAULT 0,
        "internal_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallets_address" PRIMARY KEY ("address")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "trades"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
    await queryRunner.query(`DROP TABLE "markets"`);
  }
}
