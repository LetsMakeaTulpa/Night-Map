import { describe, expect, it } from "vitest";
import { distanceMeters, mapillaryCoverageTileUrl, mapillarySearchUrl } from "./mapillary";

describe("mapillary search", () => {
  it("asks for a 50 m radius with the fields the panel renders", () => {
    const url = new URL(mapillarySearchUrl([-122.4085, 37.7835], "client-token"));
    expect(url.hostname).toBe("graph.mapillary.com");
    expect(url.searchParams.get("radius")).toBe("50");
    expect(url.searchParams.get("limit")).toBe("24");
    expect(url.searchParams.get("lat")).toBe("37.7835");
    expect(url.searchParams.get("lng")).toBe("-122.4085");
    expect(url.searchParams.get("fields")).toContain("thumb_2048_url");
    expect(url.searchParams.get("access_token")).toBe("client-token");
  });

  it("builds a coverage tile URL without losing the tile placeholders", () => {
    const url = mapillaryCoverageTileUrl("client|token");
    expect(url).toContain("tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}");
    expect(url).toContain("access_token=client%7Ctoken");
  });

  it("orders images by real metres", () => {
    const here: [number, number] = [-122.4085, 37.7835];
    expect(distanceMeters(here, here)).toBe(0);
    expect(distanceMeters(here, [here[0], here[1] + 0.001])).toBeCloseTo(111.2, 0);
  });
});
