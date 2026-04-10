import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMarketResolutionColumns1775865600000
  implements MigrationInterface
{
  name = "AddMarketResolutionColumns1775865600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "markets" ADD COLUMN "winning_token_id" character varying(256)`,
    );
    await queryRunner.query(
      `ALTER TABLE "markets" ADD COLUMN "winning_outcome" character varying(256)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "markets" DROP COLUMN "winning_outcome"`,
    );
    await queryRunner.query(
      `ALTER TABLE "markets" DROP COLUMN "winning_token_id"`,
    );
  }
}
