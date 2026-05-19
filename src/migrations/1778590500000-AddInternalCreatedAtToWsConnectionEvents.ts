import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInternalCreatedAtToWsConnectionEvents1778590500000 implements MigrationInterface {
  name = "AddInternalCreatedAtToWsConnectionEvents1778590500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ws_connection_events"
      ADD COLUMN "internal_created_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      UPDATE "ws_connection_events"
      SET "internal_created_at" = "at"
      WHERE "internal_created_at" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ws_connection_events"
      ALTER COLUMN "internal_created_at" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ws_connection_events"
      ALTER COLUMN "internal_created_at" SET DEFAULT now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ws_connection_events" DROP COLUMN "internal_created_at"
    `);
  }
}
