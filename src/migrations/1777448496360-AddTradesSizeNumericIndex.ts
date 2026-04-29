import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTradesSizeNumericIndex1777448496360 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Функциональный индекс для ускорения фильтрации китов по размеру сделки
        await queryRunner.query(`
            CREATE INDEX "idx_trades_size_numeric"
            ON "trades" ((CAST("size" AS DECIMAL)))
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_trades_size_numeric"`);
    }

}
