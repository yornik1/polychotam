import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AlertSettingsService } from "./alert-settings.service.js";
import { AppSetting } from "./app-setting.entity.js";

@Module({
  imports: [TypeOrmModule.forFeature([AppSetting])],
  providers: [AlertSettingsService],
  exports: [AlertSettingsService],
})
export class SettingsModule {}
