import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAppSettingsTable1778585000000 implements MigrationInterface {
  name = "AddAppSettingsTable1778585000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "app_settings" (
        "key" character varying(64) NOT NULL,
        "value" text NOT NULL,
        "internal_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_settings_key" PRIMARY KEY ("key")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "app_settings" ("key", "value") VALUES ('alerts_enabled', 'true')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "app_settings"`);
  }
}
