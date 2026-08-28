import { describe, expect, it } from "vitest";
import { A2UIActivityDocument } from "./activity-document.js";

describe("A2UIActivityDocument", () => {
  it("replaces a snapshot and applies a valid RFC 6902 delta", () => {
    const document = new A2UIActivityDocument();
    document.replace({
      status: "building",
      a2ui_operations: [
        {
          version: "v0.9",
          createSurface: { surfaceId: "s1", catalogId: "c1" },
        },
      ],
    });

    document.patch([
      { op: "replace", path: "/status", value: "painted" },
      {
        op: "add",
        path: "/a2ui_operations/-",
        value: {
          version: "v0.9",
          updateComponents: { surfaceId: "s1", components: [] },
        },
      },
    ]);

    expect(document.content).toMatchObject({ status: "painted" });
    expect(document.operations).toHaveLength(2);
  });

  it("retains the last valid document when a patch fails", () => {
    const document = new A2UIActivityDocument();
    document.replace({ status: "building", a2ui_operations: [] });

    expect(() =>
      document.patch([{ op: "replace", path: "/missing", value: true }]),
    ).toThrow("Invalid A2UI activity patch");
    expect(document.content).toEqual({
      status: "building",
      a2ui_operations: [],
    });
  });

  it("returns no operations for lifecycle-only content", () => {
    const document = new A2UIActivityDocument();
    document.replace({ status: "retrying", attempt: 2 });
    expect(document.operations).toBeUndefined();
  });
});
