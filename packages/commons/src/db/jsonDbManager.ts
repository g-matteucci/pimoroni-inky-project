import { writeFileSync, accessSync, readFileSync, unlinkSync } from "fs";

export class JsonDBManager<
  TSchema extends {
    id: string;
  }
> {
  private dbData: TSchema[];

  constructor(private dbPath: string) {
    try {
      accessSync(this.dbPath);
      this.dbData = JSON.parse(readFileSync(this.dbPath, "utf-8")) as TSchema[];
    } catch (error) {
      writeFileSync(this.dbPath, JSON.stringify([], null, 2), "utf-8");
      this.dbData = [];
    }
  }

  private commitChanges(): void {
    writeFileSync(this.dbPath, JSON.stringify(this.dbData, null, 2), "utf-8");
  }

  addItem(item: TSchema): void {
    this.dbData.push(item);
    this.commitChanges();
  }

  getItemById(id: string): TSchema | null {
    return this.dbData.find((item) => item.id === id) || null;
  }

  getAllItems(): TSchema[] {
    return this.dbData;
  }

  deleteItemById(id: string): void {
    this.dbData = this.dbData.filter((item) => item.id !== id);
    this.commitChanges();
  }

  updateItem(item: TSchema): void {
    const index = this.dbData.findIndex((i) => i.id === item.id);
    if (index !== -1) {
      this.dbData[index] = item;
      this.commitChanges();
    } else {
      throw new Error(`Item with id ${item.id} not found`);
    }
  }

  clearDB(): void {
    this.dbData = [];
    this.commitChanges();
  }

  deleteDB(): void {
    unlinkSync(this.dbPath);
  }

  getRandomItem(): TSchema | null {
    if (this.dbData.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * this.dbData.length);
    return this.dbData[randomIndex] || null;
  }
}
