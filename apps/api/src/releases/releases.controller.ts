import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { CreateReleaseDto, SetSubdomainDto } from "./dto";
import { ReleasesService } from "./releases.service";

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MAX_ZIP_BYTES = 150 * 1024 * 1024; // generous for a built static site's dist/ folder

/**
 * "Setiap yang menghasilkan file script bisa langsung di-release ke Caddy" -
 * one small lifecycle: stage files (zip upload or an existing chat/meeting
 * .html attachment) -> preview in a new tab -> pick a subdomain -> Direktur
 * adds the DNS A record at their provider -> go-live once DNS resolves here.
 */
@Controller("releases")
export class ReleasesController {
  constructor(private readonly service: ReleasesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_ZIP_BYTES } }))
  async create(@UploadedFile() file: MulterFile | undefined, @Body() dto: CreateReleaseDto) {
    if (file) return this.service.createFromUpload(dto.title, file.buffer, file.originalname, file.mimetype);
    if (dto.attachmentId) return this.service.createFromAttachment(dto.title, dto.attachmentId);
    throw new BadRequestException("Kirim file zip/html, atau attachmentId dari lampiran chat/rapat yang sudah ada.");
  }

  // Preview root (no trailing path) - serves staging/index.html.
  @Get(":id/preview")
  async previewRoot(@Param("id") id: string, @Res() res: Response) {
    return this.servePreview(id, "", res);
  }

  // Preview of a nested asset (css/js/images/...) under the staged site.
  @Get(":id/preview/*")
  async previewAsset(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    const subpath = (req.params as Record<string, string>)["0"] ?? "";
    return this.servePreview(id, subpath, res);
  }

  private async servePreview(id: string, subpath: string, res: Response) {
    try {
      const { buffer, contentType } = await this.service.previewFile(id, subpath);
      res.set({ "Content-Type": contentType, "Cache-Control": "no-store" });
      res.send(buffer);
    } catch (err) {
      if (err instanceof NotFoundException) {
        res.status(404).send("Not found");
        return;
      }
      throw err;
    }
  }

  @Post(":id/subdomain")
  setSubdomain(@Param("id") id: string, @Body() dto: SetSubdomainDto) {
    return this.service.setSubdomain(id, dto.subdomain);
  }

  @Get(":id/check-dns")
  checkDns(@Param("id") id: string) {
    return this.service.checkDns(id);
  }

  @Post(":id/go-live")
  goLive(@Param("id") id: string) {
    return this.service.goLive(id);
  }

  @Post(":id/take-down")
  takeDown(@Param("id") id: string) {
    return this.service.takeDown(id);
  }
}
