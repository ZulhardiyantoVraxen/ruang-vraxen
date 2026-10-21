import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { CaddyReleaseClient } from "./caddy-release-client";
import { ReleasesController } from "./releases.controller";
import { ReleasesService } from "./releases.service";

@Module({
  imports: [UploadsModule],
  controllers: [ReleasesController],
  providers: [ReleasesService, CaddyReleaseClient],
})
export class ReleasesModule {}
