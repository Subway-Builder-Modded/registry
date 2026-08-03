import type { ManifestType } from "./manifests.js";
import type { IntegrityOutput, IntegrityCache } from "./integrity.js";
import type { DownloadAttributionDelta, DownloadAttributionLedger } from "./download-attribution.js";
import type { DownloadVersionBucketLedger } from "./download-version-buckets.js";

export interface ParsedReleaseAssetUrl {
  repo: string;
  owner: string;
  name: string;
  tag: string;
  assetName: string;
}

export interface GraphqlReleaseAssetNode {
  id: string;
  name: string;
  downloadCount: number;
  downloadUrl: string;
  size?: number | null;
  updatedAt?: string | null;
}

export interface GraphqlReleaseNode {
  tagName: string;
  publishedAt: string | null;
  releaseAssets: {
    nodes: GraphqlReleaseAssetNode[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

export interface GraphqlRateLimitInfo {
  remaining: number;
  cost: number;
  resetAt: string;
}

export interface GraphqlReleasesResponse {
  data?: {
    repository: {
      releases: {
        nodes: GraphqlReleaseNode[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    } | null;
    rateLimit?: GraphqlRateLimitInfo;
  };
  errors?: Array<{ message: string }>;
}

export interface RepoReleaseTagData {
  zipTotal: number;
  // ISO 8601 release publish timestamp; used to derive a listing's last_updated.
  // Optional: only the full release-index path captures it (the download-count
  // aggregation path leaves it undefined).
  publishedAt?: string | null;
  assets: Map<string, {
    assetNodeId: string | null;
    downloadCount: number;
    downloadUrl: string | null;
    sizeBytes: number | null;
    // ISO 8601 timestamp of last asset update from GitHub API; populated by full
    // release-index path only. Used to detect asset replacement (clobber).
    assetUpdatedAt?: string | null;
  }>;
}

export interface RepoReleaseIndex {
  byTag: Map<string, RepoReleaseTagData>;
}

export interface RateLimitWarningState {
  warned: boolean;
}

export interface GraphqlUsageState {
  queries: number;
  totalCost: number;
  firstRemaining: number | null;
  lastRemaining: number | null;
  resetAt: string | null;
}

export interface CustomVersionRef {
  listingId: string;
  version: string;
  repo: string;
  tag: string;
  assetName: string;
}

export interface DownloadsByListing {
  [listingId: string]: {
    [version: string]: number;
  };
}

export interface GenerateDownloadsOptions {
  repoRoot: string;
  listingType: ManifestType;
  mode?: "full" | "download-only";
  strictFingerprintCache?: boolean;
  forceIntegrityRecheck?: boolean;
  // Per-listing forced recheck: bypasses the integrity cache for ONLY these
  // listing ids. The safe alternative to a global forced recheck (which
  // re-inspects every release and risks rate-limit cascades) when a listing's
  // release assets were edited in place — e.g. a retroactive game_version
  // change via a replaced manifest.json asset, which the zip-only
  // fingerprint/clobber detection cannot see.
  forceRecheckListings?: string[];
  attribution?: {
    ledger: DownloadAttributionLedger;
    delta: DownloadAttributionDelta;
  };
  versionBuckets?: {
    ledger: DownloadVersionBucketLedger;
  };
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface DownloadVersionBucketInput {
  bucketKey: string;
  adjustedCount: number;
}

export type VersionBucketInputsByListing = Record<string, Record<string, DownloadVersionBucketInput[]>>;

export interface IntegrityAlert {
  listingId: string;
  listingName: string;
  listingType: "map" | "mod";
  authorId: string;
  // GitHub ID of the listing's ACTIVE caretaker, when one exists — alert
  // notifications route to them instead of the author (who may be the org
  // admin account for admin-authored/caretaken listings).
  caretakerGithubId?: number;
  version: string;
  isRegression: boolean;
  failingChecks: string[];
  errors: string[];
  sourceRepo?: string;
  sourceTag?: string;
}

export interface GenerateDownloadsResult {
  downloads: DownloadsByListing;
  versionBucketInputs: VersionBucketInputsByListing;
  integrity: IntegrityOutput;
  integrityCache: IntegrityCache;
  integrityAlerts: IntegrityAlert[];
  stats: {
    listings: number;
    versions_checked: number;
    complete_versions: number;
    incomplete_versions: number;
    filtered_versions: number;
    cache_hits: number;
    registry_fetches_added: number;
    adjusted_delta_total: number;
    clamped_versions: number;
  };
  warnings: string[];
  rateLimit: {
    queries: number;
    totalCost: number;
    firstRemaining: number | null;
    lastRemaining: number | null;
    estimatedConsumed: number | null;
    resetAt: string | null;
  };
}

export interface RepoReleasesPage {
  releases: {
    nodes: GraphqlReleaseNode[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
  rateLimit?: GraphqlRateLimitInfo;
}

export type RepoReleasesPageResult =
  | { ok: true; page: RepoReleasesPage }
  | { ok: false; error: string; unavailable: boolean };

export const GRAPHQL_RATE_LIMIT_WARN_THRESHOLD = 200;
export const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

export const REPO_RELEASES_QUERY = `
  query RepoReleases($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      releases(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          tagName
          publishedAt
          releaseAssets(first: 100) {
            nodes {
              id
              name
              downloadCount
              downloadUrl
              size
              updatedAt
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    rateLimit {
      remaining
      cost
      resetAt
    }
  }
`;

