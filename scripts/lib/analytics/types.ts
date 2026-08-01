export interface SnapshotEntry {
  file: string;
  date: Date;
}

export interface SnapshotData {
  schema_version?: unknown;
  snapshot_date?: unknown;
  generated_at?: unknown;
  total_downloads?: unknown;
  raw_total_downloads?: unknown;
  total_attributed_downloads?: unknown;
  net_downloads?: unknown;
  maps?: { downloads?: Record<string, Record<string, unknown>> };
  mods?: { downloads?: Record<string, Record<string, unknown>> };
}

export type ListingTotals = Map<ListingKey, number>;

export interface ListingMeta {
  name: string;
  author: string;
  author_alias: string;
  attribution_link: string;
  github_id: number | null;
}

export interface ListingProjectRow {
  listing_type: "map" | "mod";
  id: string;
  name: string;
  project_key: string;
  project_name: string;
}

export interface MapStatisticsRow {
  rank: number;
  id: string;
  name: string;
  author: string;
  author_alias: string;
  attribution_link: string;
  city_code: string;
  country: string;
  population: number;
  population_count: number;
  points_count: number;
  n_cells: number;
  mean_point_density: number;
  median_resident_weighted_nn_km: number;
  mean_resident_weighted_nn_km: number;
  median_worker_weighted_nn_km: number;
  mean_worker_weighted_nn_km: number;
  detail_radius_km: number;
  detail_score: number;
  playable_area_cells: number;
  median_cell_resident_density: number;
  mean_cell_resident_density: number;
  pct_cells_with_residents: number;
  median_cell_worker_density: number;
  mean_cell_worker_density: number;
  pct_cells_with_workers: number;
  median_commute_distance: number;
  mean_commute_distance: number;
  detected_center_count: number;
  polycentrism_score: number;
}

export interface AssetByDayRow {
  snapshot_date: string;
  total_downloads: number;
  maps: number;
  mods: number;
  total_downloads_signed: number;
  maps_signed: number;
  mods_signed: number;
  total_downloads_clamped: number;
  maps_clamped: number;
  mods_clamped: number;
  cumulative_total: number;
  cumulative_maps: number;
  cumulative_mods: number;
  total_new_assets: number;
  new_maps: number;
  new_mods: number;
  cumulative_assets: number;
  cumulative_maps_assets: number;
  cumulative_mods_assets: number;
  total_new_assets_versions: number;
  new_maps_versions: number;
  new_mods_versions: number;
  cumulative_asset_versions: number;
  cumulative_maps_versions: number;
  cumulative_mods_versions: number;
}

export type DailySeriesRow = Record<string, string | number>;
export type ListingKey = `${"maps" | "mods"}:${string}`;

// One unit of download credit for the author aggregations: a listing's totals
// credited to a single person. Listings without caretakers produce exactly one
// entry (the author, listing-grain totals, today's behavior); listings whose
// versions are credited to different persons produce one entry per person, with
// totals rolled up from (listing, version) grain.
export interface AuthorCreditEntry {
  listingType: "maps" | "mods";
  person: {
    author: string;
    author_alias: string;
    attribution_link: string;
  };
  // Monotonic total at the latest snapshot.
  currentTotal: number;
  // Adjusted (raw snapshot) total at the latest snapshot.
  currentAdjusted: number;
  monotonicAt(snapshotFile: string): number;
  adjustedAt(snapshotFile: string): number;
  deltaAt(snapshotFile: string): number;
}
