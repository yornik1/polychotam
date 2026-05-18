import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWsConnectionEventsTable1778590000000 implements MigrationInterface {
  name = "AddWsConnectionEventsTable1778590000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ws_connection_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" character varying(8) NOT NULL,
        "at" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_ws_connection_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ws_connection_events_at" ON "ws_connection_events" ("at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_ws_connection_events_at"`);
    await queryRunner.query(`DROP TABLE "ws_connection_events"`);
  }
}
