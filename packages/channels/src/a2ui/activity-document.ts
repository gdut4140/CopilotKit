import fastJsonPatch from "fast-json-patch";
import type { Operation } from "fast-json-patch";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class A2UIActivityDocument {
  private retained?: Record<string, unknown>;

  get content(): Readonly<Record<string, unknown>> | undefined {
    return this.retained;
  }

  get operations(): ReadonlyArray<Record<string, unknown>> | undefined {
    const operations = this.retained?.a2ui_operations;
    if (!Array.isArray(operations)) return undefined;
    if (!operations.every(isRecord)) return undefined;
    return operations;
  }

  get revision(): string | undefined {
    return this.operations ? JSON.stringify(this.operations) : undefined;
  }

  replace(content: Record<string, unknown>): void {
    this.retained = structuredClone(content);
  }

  patch(patch: unknown[]): void {
    if (!this.retained) {
      throw new Error("A2UI activity delta arrived before a snapshot");
    }
    const candidate = structuredClone(this.retained);
    try {
      this.retained = fastJsonPatch.applyPatch(
        candidate,
        patch as Operation[],
        true,
        true,
        true,
      ).newDocument;
    } catch {
      throw new Error("Invalid A2UI activity patch");
    }
  }
}
