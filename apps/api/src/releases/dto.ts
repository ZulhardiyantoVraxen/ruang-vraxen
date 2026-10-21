import { IsOptional, IsString, Matches } from "class-validator";

export class CreateReleaseDto {
  @IsString()
  title!: string;

  // Alternative to uploading a "file" (zip) on the same multipart request:
  // reuse a file already attached to a chat/meeting message (must be a
  // single .html/.htm file - see ReleasesService.createFromAttachment).
  @IsOptional()
  @IsString()
  attachmentId?: string;
}

const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class SetSubdomainDto {
  @IsString()
  @Matches(SUBDOMAIN_PATTERN, {
    message: "Subdomain hanya boleh huruf kecil, angka, dan tanda hubung (bukan di awal/akhir).",
  })
  subdomain!: string;
}
