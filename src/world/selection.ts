/** Shared timing for canvas hits and DOM labels. Selection is immediate; flight is deferred. */
export class WorldSelection {
  private timer?: ReturnType<typeof setTimeout>;
  private last = {id: '', time: 0};
  constructor(private actions: {select(id: string): void; locate(id: string): void; activate(id: string): void}) {}
  click(id: string): void {
    const now = Date.now();
    if (this.last.id === id && now - this.last.time < 350) {this.activate(id); return;}
    this.cancel(); this.last = {id, time: now}; this.actions.select(id);
    this.timer = setTimeout(() => {this.timer = undefined; this.actions.locate(id);}, 350);
  }
  activate(id: string): void {this.cancel(); this.last = {id: '', time: 0}; this.actions.activate(id);}
  cancel(): void {clearTimeout(this.timer); this.timer = undefined;}
}
