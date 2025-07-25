import { accessSync, mkdirSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import path from "path";
import { LOCAL_STORAGE_PATH } from "../constants.js";

export class ImageStorageService {
  constructor(private storagePath: string = LOCAL_STORAGE_PATH) {
    try {
      accessSync(this.storagePath);
    } catch (error) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }

  saveImage(imageId: string, image: Buffer): void {
    const localFilePath = this.getFileFullPath(imageId);
    writeFileSync(localFilePath, image);
  }

  deleteImage(imageId: string): void {
    const localFilePath = this.getFileFullPath(imageId);
    try {
      accessSync(localFilePath);
      unlinkSync(localFilePath);
    } catch {
      return;
    }
  }

  listImages(): string[] {
    return readdirSync(this.storagePath).filter((file) => file.endsWith(".jpg"));
  }

  getFileFullPath(filename: string): string {
    return path.join(this.storagePath, filename.endsWith(".jpg") ? filename : `${filename}.jpg`);
  }
}
