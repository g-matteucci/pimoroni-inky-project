export class HistoryRandomPickerService<T> {
  private history: T[] = [];
  constructor(private items: T[], private cooldown: number = 5) {}

  pick(): T | null {
    const candidates = this.items.filter((item) => !this.history.includes(item));
    if (candidates.length === 0) {
      this.history = [];
      return this.pick();
    }
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    if (!choice) return null;

    this.history.push(choice);
    if (this.history.length > this.cooldown) this.history.shift();
    return choice;
  }
}
