// Keep interceptors installed until every callback has settled. In Playwright,
// unrouteAll(wait) empties the routing list before waiting; a completing callback
// can then remove the server interceptor while another route.fetch is pending.
export class RouteDrain {
  private pending = new Set<Promise<void>>();

  async run<T>(callback: () => Promise<T>): Promise<T> {
    let finish!: () => void;
    const completed = new Promise<void>(resolve => { finish = resolve; });
    this.pending.add(completed);
    try { return await callback(); }
    finally { this.pending.delete(completed); finish(); }
  }

  async wait() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }
}
