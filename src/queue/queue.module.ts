import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { QueueController } from "./queue.controller.js";
import { QueueService } from "./queue.service.js";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "default"
    })
  ],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService]
})
export class QueueModule {}
