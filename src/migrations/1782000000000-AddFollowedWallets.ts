import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFollowedWallets1782000000000 implements MigrationInterface {
  name = "AddFollowedWallets1782000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "followed_wallets" (
        "address" character varying(128) NOT NULL,
        "internal_created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_followed_wallets_address" PRIMARY KEY ("address")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "followed_wallets"`);
  }
}
