import { Module } from "@nestjs/common";
import { CommonController } from "./common.controller.js";
import { CommonService } from "./common.service.js";

@Module({
  controllers: [CommonController],
  providers: [CommonService],
  exports: [CommonService]
})
export class CommonModule {}
