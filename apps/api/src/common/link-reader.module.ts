import { Module } from "@nestjs/common";
import { LinkReaderService } from "./link-reader.service";

@Module({
  providers: [LinkReaderService],
  exports: [LinkReaderService],
})
export class LinkReaderModule {}
