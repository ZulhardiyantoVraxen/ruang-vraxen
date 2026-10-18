import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { UploadsService } from "./uploads.service";

// No @types/multer in this project - the interceptor hands back a plain
// object with these fields, which is all this controller needs.
interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB - generous for the kind of docs/screenshots a director attaches, without letting one upload exhaust the bucket

/**
 * "Di semua menu chat ada file upload, bisa berupa apapun" - one shared
 * upload endpoint for every chat/command surface in the app (agent chat,
 * broadcast/perintah, and any future one): upload once here, then pass the
 * returned {id, filename, mimeType} along as an attachment on the actual
 * chat/task-creation call, instead of each feature reinventing storage.
 */
@Controller("uploads")
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: MulterFile) {
    if (!file) throw new BadRequestException("Tidak ada file yang dikirim.");
    const meta = await this.service.save(file);
    return { ...meta, url: `/uploads/${meta.id}` };
  }

  @Get(":id")
  async download(@Param("id") id: string, @Res() res: Response) {
    try {
      const { buffer, contentType } = await this.service.getFile(id);
      // Original filename is everything after the first "-" in the id (see UploadsService.save).
      const filename = id.slice(id.indexOf("-") + 1) || id;
      res.set({
        "Content-Type": contentType ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      });
      res.send(buffer);
    } catch {
      throw new NotFoundException("File tidak ditemukan.");
    }
  }
}
