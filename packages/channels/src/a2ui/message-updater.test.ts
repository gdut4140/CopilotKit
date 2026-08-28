import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageRef, Renderable, Thread } from "@copilotkit/channels-core";
import { A2UIMessageUpdater } from "./message-updater.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const makeThread = () => {
  const ref = { id: "message-1" };
  return {
    ref,
    post: vi.fn(async (_ui: Renderable) => ref),
    update: vi.fn(async (_ref: MessageRef, _ui: Renderable) => ref),
  };
};

afterEach(() => vi.useRealTimers());

describe("A2UIMessageUpdater", () => {
  it("posts once and coalesces pending revisions behind an in-flight update", async () => {
    vi.useFakeTimers();
    const thread = makeThread();
    const first = deferred<MessageRef>();
    thread.update
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(thread.ref);
    const updater = new A2UIMessageUpdater(
      thread as Pick<Thread, "post" | "update">,
      800,
    );

    await updater.start("Building interface…");
    updater.offer("one", "r1");
    await vi.advanceTimersByTimeAsync(800);
    updater.offer("two", "r2");
    updater.offer("three", "r3");
    first.resolve(thread.ref);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);
    await updater.finish();

    expect(thread.post).toHaveBeenCalledOnce();
    expect(thread.update.mock.calls.map((call) => call[1])).toEqual([
      "one",
      "three",
    ]);
  });

  it("suppresses duplicate revisions and makes finish idempotent", async () => {
    vi.useFakeTimers();
    const thread = makeThread();
    const updater = new A2UIMessageUpdater(
      thread as Pick<Thread, "post" | "update">,
      0,
    );

    await updater.start("Building interface…");
    updater.offer("one", "r1");
    updater.offer("same", "r1");
    const firstFinish = updater.finish();
    const secondFinish = updater.finish();
    await Promise.all([firstFinish, secondFinish]);

    expect(firstFinish).toBe(secondFinish);
    expect(thread.update).toHaveBeenCalledOnce();
  });

  it("keeps a failed revision pending for the final retry", async () => {
    vi.useFakeTimers();
    const thread = makeThread();
    thread.update
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue(thread.ref);
    const updater = new A2UIMessageUpdater(
      thread as Pick<Thread, "post" | "update">,
      0,
    );

    await updater.start("Building interface…");
    updater.offer("latest", "r1");
    await vi.runOnlyPendingTimersAsync();
    await updater.finish();

    expect(thread.update).toHaveBeenCalledTimes(2);
  });
});
