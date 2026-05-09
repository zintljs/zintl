import { describe, it, expect } from "vite-plus/test";
import { reconcileManifests } from "../reconcile.js";

describe("Catalog Reconciliation", () => {
  it("should detect a move between boundaries", () => {
    const prev = {
      "src/A": [{ id: "1", text: "Hello", context: "", boundaryId: "src/A", location: {} }],
      "src/B": [],
    };
    const curr = {
      "src/A": [],
      "src/B": [{ id: "1", text: "Hello", context: "", boundaryId: "src/B", location: {} }],
    };

    const result = reconcileManifests(prev, curr);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]).toEqual({
      fromBoundary: "src/A",
      toBoundary: "src/B",
      text: "Hello",
    });
  });

  it("should detect a true delete", () => {
    const prev = {
      "src/A": [{ id: "1", text: "Hello", context: "", boundaryId: "src/A", location: {} }],
    };
    const curr = {
      "src/A": [],
    };

    const result = reconcileManifests(prev, curr);
    expect(result.deletes["src/A"]).toBeDefined();
    expect(result.deletes["src/A"].has("Hello")).toBe(true);
  });

  it("should not detect a delete if it matches a rename", () => {
    const prev = {
      "src/A": [
        {
          id: "1",
          text: "Welcome to our application!",
          context: "",
          boundaryId: "src/A",
          location: {},
        },
      ],
    };
    const curr = {
      "src/A": [
        {
          id: "1",
          text: "Welcome to our application.",
          context: "",
          boundaryId: "src/A",
          location: {},
        },
      ],
    };

    const result = reconcileManifests(prev, curr, 0.6);
    expect(result.renames["src/A"]["*"]["Welcome to our application!"]).toBe(
      "Welcome to our application.",
    );
    expect(result.deletes["src/A"]).toBeUndefined();
  });
});
