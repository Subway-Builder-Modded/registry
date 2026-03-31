import { writeFileSync } from "node:fs";
import JSZip from "jszip";

export type FetchRoute = {
  match: (url: string) => boolean;
  handle: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
};

export const DEFAULT_INITIAL_VIEW_STATE = {
  latitude: 38.312462,
  longitude: 140.325418,
  zoom: 12,
  bearing: 0,
};

export function makeFetchRouter(routes: FetchRoute[]): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const route = routes.find((entry) => entry.match(url));
    if (!route) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return route.handle(input, init);
  }) as typeof fetch;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function buildDemandPayload(
  pointResidents: Array<number | undefined>,
  populationSizes: number[],
): Record<string, unknown> {
  return {
    points: pointResidents.map((residents, index) => {
      const point: Record<string, unknown> = {
        id: `pt${index + 1}`,
        location: [index * 0.03, index * 0.03],
        jobs: index + 1,
      };
      if (residents !== undefined) {
        point.residents = residents;
      }
      return point;
    }),
    pops_map: populationSizes.map((size, index) => ({
      id: `pop${index + 1}`,
      size,
    })),
    pops: pointResidents.map((_, index) => ({
      residenceId: `pt${index + 1}`,
      jobId: `pt${index + 1}`,
      drivingDistance: (index + 1) * 10,
    })),
  };
}

export async function makeZipBuffer(fileName: string, content: Buffer | string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(fileName, content);
  zip.file(
    "config.json",
    JSON.stringify({
      code: "TST",
      initialViewState: DEFAULT_INITIAL_VIEW_STATE,
    }),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function makeDemandZip(residents: number[]): Promise<Buffer> {
  const payload = {
    points: residents.map((value, index) => ({
      id: `pt${index + 1}`,
      location: [index * 0.03, index * 0.03],
      jobs: index + 1,
      residents: value,
    })),
    pops_map: residents.map((value, index) => ({
      id: `pop${index + 1}`,
      size: value,
    })),
    pops: residents.map((_, index) => ({
      residenceId: `pt${index + 1}`,
      jobId: `pt${index + 1}`,
      drivingDistance: (index + 1) * 10,
    })),
  };
  return makeZipBuffer("demand_data.json", JSON.stringify(payload));
}
