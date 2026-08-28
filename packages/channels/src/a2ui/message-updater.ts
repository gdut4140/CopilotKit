import type { MessageRef, Renderable, Thread } from "@copilotkit/channels-core";

interface OfferedRevision {
  readonly ui: Renderable;
  readonly revision: string;
}

export class A2UIMessageUpdater {
  private ref?: MessageRef;
  private pending?: OfferedRevision;
  private deliveredRevision?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private lastDeliveryStartedAt = 0;
  private finishPromise?: Promise<void>;

  constructor(
    private readonly thread: Pick<Thread, "post" | "update">,
    private readonly minUpdateIntervalMs: number,
  ) {}

  async start(building: Renderable): Promise<void> {
    if (!this.ref) this.ref = await this.thread.post(building);
  }

  offer(ui: Renderable, revision: string): void {
    if (this.finishPromise) return;
    if (
      revision === this.deliveredRevision ||
      revision === this.pending?.revision
    ) {
      return;
    }
    this.pending = { ui, revision };
    this.schedule();
  }

  finish(): Promise<void> {
    this.finishPromise ??= this.finishOnce();
    return this.finishPromise;
  }

  private schedule(): void {
    if (this.timer || this.inFlight || !this.pending || !this.ref) return;
    const delay = Math.max(
      0,
      this.lastDeliveryStartedAt + this.minUpdateIntervalMs - Date.now(),
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.pump(false);
    }, delay);
  }

  private pump(finalAttempt: boolean): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const next = this.pending;
    if (!next || !this.ref) return Promise.resolve();
    this.pending = undefined;
    this.lastDeliveryStartedAt = Date.now();
    this.inFlight = this.thread
      .update(this.ref, next.ui)
      .then((ref) => {
        this.ref = ref;
        this.deliveredRevision = next.revision;
      })
      .catch((error) => {
        this.pending ??= next;
        if (finalAttempt) throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
        if (!this.finishPromise) this.schedule();
      });
    return this.inFlight;
  }

  private async finishOnce(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight) await this.inFlight;
    if (this.pending) await this.pump(true);
  }
}
