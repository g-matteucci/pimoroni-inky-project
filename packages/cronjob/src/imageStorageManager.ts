import { accessSync, mkdirSync, existsSync, writeFileSync } from "fs";
import path from "path";

export class ImageStorageManager {
  constructor(private tempPath: string) {
    try {
      accessSync(this.tempPath);
    } catch (error) {
      mkdirSync(this.tempPath, { recursive: true });
    }
  }

  private async downloadImage(fileUrl: string): Promise<Buffer> {
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  }

  async withDownloadedImage(fileUrl: string, ...callbacks: ((filePath: string) => void)[]): Promise<void> {
    const filename = path.basename(fileUrl);
    const localFilePath = this.getFilePath(filename);

    const fileExists = existsSync(localFilePath);

    if (fileExists) {
      return callbacks.forEach((callback) => callback(localFilePath));
    }

    const downloadedFile = await this.downloadImage(fileUrl);
    writeFileSync(localFilePath, downloadedFile);

    return callbacks.forEach((callback) => callback(localFilePath));
  }

  private getFilePath(filename: string): string {
    return path.join(this.tempPath, filename);
  }
}
