<!-- GENERAL_LISTING_TEMPLATE.md
     Generic listing template for Subway Builder map descriptions rendered
     by Railyard, the Subway Builder Modded team's all-in-one mod and map manaager for
     the game Subway Builder.

     Rendered via react-markdown (supports standard markdown + inline HTML).

     This template is locale-agnostic — it can be used for any city in any
     country. Map creators should fill in the Special Demand section with
     categories relevant to their region.

     Placeholders use {{PLACEHOLDER}} syntax for script substitution.
     Conditional blocks use {{#IF code}}...{{/IF}} — only emitted when
     the map's config.json contains that code in specialDemandTypes.

     A generation script (or manual editing) should populate these from
     config.json, index.json, and demand_data export at publish time.
     Output filename: {MAP_CODE}.md (matching the .pmtiles convention).

     PREVIEW IMAGE:
       By default the first screenshot is used (screenshot1.png).
       Map packs with a generated preview can override this to preview.png
       or any other filename.

     SPECIAL DEMAND:
       The special demand section below provides example categories
       (Infrastructure, Education, Attractions) as a starting point.
       Creators should add, remove, or rename categories to match their
       map's content. Each category uses the same collapsible table
       pattern — copy a block and adjust the code, label, and stat column.

     METHODOLOGY & DATA SOURCES:
       Creators should replace the placeholder text with a description
       of their own data pipeline and sources.
-->

# {{MAP_NAME}}

### {{MAP_CODE}} · {{VERSION}}

{{LISTING_TAGLINE}}

![Map Preview](screenshot1.png)

## Coverage

<table style="width: auto">
<tr><td><strong>Region</strong></td><td>{{REGION_NAME}}</td></tr>
<tr><td><strong>Districts / Municipalities</strong></td><td>{{DISTRICT_COUNT}}</td></tr>
<tr><td><strong>Playable Area</strong></td><td>{{PLAYABLE_AREA_KM2}} km²</td></tr>
</table>

<details>
<summary>District list</summary>

<table style="width: auto">
<tr><th align="left">Code</th><th align="left">District</th><th align="right">Population</th></tr>
{{DISTRICT_ROWS}}
</table>

</details>

## Population Summary

<table style="width: auto">
<tr><td><strong>Total Population</strong></td><td align="right">{{TOTAL_POPULATION}}</td></tr>
<tr><td><strong>Working Age Population</strong></td><td align="right">{{WORKING_AGE_POPULATION}}</td></tr>
<tr><td><strong>Total Modeled Demand</strong></td><td align="right">{{TOTAL_MODELED_DEMAND}}</td></tr>
<tr><td><strong>Modeled Normal Demand</strong></td><td align="right">{{TOTAL_NORMAL_DEMAND}}</td></tr>
<tr><td><strong>Modeled Special Demand</strong></td><td align="right">{{SPECIAL_DEMAND_POPULATION}}</td></tr>
</table>

## Map Statistics

<table style="width: auto">
<tr><td><strong>Buildings Indexed</strong></td><td align="right">{{BUILDINGS_INDEXED}}</td></tr>
<tr><td><strong>Demand Points</strong></td><td align="right">{{TOTAL_DEMAND_POINTS}}</td></tr>
<tr><td><strong>Populations</strong></td><td align="right">{{TOTAL_POPS}}</td></tr>
<!-- Optional distribution stats — add rows here if your pipeline computes them.
     Common examples:
       Median / Mean Point Size      (demand points per population node)
       Median / Mean Population Size (residents per population node)
       Median / Mean Commute Distance
-->
</table>

## Special Demand

<!-- ================================================================
     INSTRUCTIONS FOR MAP CREATORS

     The sections below are EXAMPLES organized by category. You should
     customize them to match your map's actual special demand types.

     To add a category:
       1. Choose a unique code (e.g. "metro_station", "football_stadium")
       2. Copy one of the {{#IF}}...{{/IF}} blocks below
       3. Replace the code, display label, and stat column header
       4. Add the code to your config.json specialDemandTypes array

     To remove a category:
       Delete the entire {{#IF code}}...{{/IF}} block.

     The stat column (e.g. "Annual Passengers", "Bed Capacity") should
     reflect the real-world metric used to estimate demand for that type.
     If no source stat is available, use a 3-column table without it.

     Common stat columns by type:
       Airports / Ports / Stations    -> Annual Passengers
       Hospitals / Clinics            -> Bed Capacity
       Schools / Universities         -> Enrollment
       Attractions / Landmarks        -> Annual Visitors
       Shopping / Commercial          -> Floor Area (m²)
       Sports Venues / Stadiums       -> Seat Capacity
     ================================================================ -->

### Infrastructure

{{#IF airport}}

<details>
<summary>Airports — {{airport_DEMAND}} ({{airport_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Annual Passengers</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{airport_ROWS}}
</table>

</details>
{{/IF}}

{{#IF port}}

<details>
<summary>Ports — {{port_DEMAND}} ({{port_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Annual Passengers</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{port_ROWS}}
</table>

</details>
{{/IF}}

{{#IF rail_station}}

<details>
<summary>Rail Stations — {{rail_station_DEMAND}} ({{rail_station_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Daily Ridership</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{rail_station_ROWS}}
</table>

</details>
{{/IF}}

{{#IF hospital}}

<details>
<summary>Hospitals — {{hospital_DEMAND}} ({{hospital_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Bed Capacity</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{hospital_ROWS}}
</table>

</details>
{{/IF}}

### Education

{{#IF school}}

<details>
<summary>Schools — {{school_DEMAND}} ({{school_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Enrollment</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{school_ROWS}}
</table>

</details>
{{/IF}}

{{#IF university}}

<details>
<summary>Universities — {{university_DEMAND}} ({{university_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Enrollment</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{university_ROWS}}
</table>

</details>
{{/IF}}

### Attractions

{{#IF museum}}

<details>
<summary>Museums — {{museum_DEMAND}} ({{museum_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Annual Visitors</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{museum_ROWS}}
</table>

</details>
{{/IF}}

{{#IF stadium}}

<details>
<summary>Stadiums — {{stadium_DEMAND}} ({{stadium_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Seat Capacity</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{stadium_ROWS}}
</table>

</details>
{{/IF}}

{{#IF park}}

<details>
<summary>Parks — {{park_DEMAND}} ({{park_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Annual Visitors</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{park_ROWS}}
</table>

</details>
{{/IF}}

{{#IF landmark}}

<details>
<summary>Landmarks — {{landmark_DEMAND}} ({{landmark_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Annual Visitors</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{landmark_ROWS}}
</table>

</details>
{{/IF}}

{{#IF shopping}}

<details>
<summary>Shopping Centers — {{shopping_DEMAND}} ({{shopping_PCT}}%)</summary>

<table style="width: auto">
<tr><th align="left">Name</th><th align="right">Floor Area (m²)</th><th align="right">Modeled Demand</th><th align="right">% of Section</th></tr>
{{shopping_ROWS}}
</table>

</details>
{{/IF}}

## Additional Features

<!-- ================================================================
     ADDITIONAL FEATURES — FREEFORM SECTION
     Describe any optional map features beyond the core demand model.
     Add or remove bullet points as appropriate for your map.

     Common examples:
       - Building collision data (buildings index with depth values)
       - Ocean bathymetry / ocean foundations layer
       - Neighborhood / district label overlays
       - Custom road or terrain overlays
     ================================================================ -->

<!-- Replace the bullets below with features your map actually includes. -->

- **Building Collision** — A buildings index is included, providing in-game collision geometry for all non-filtered buildings with a uniform depth value.
- **Ocean Foundations** — An ocean bathymetry layer is included, providing depth-colored ocean floor tiles for open-water areas.
- **Neighborhood Labels** — The map includes sub-municipal neighborhood label overlays derived from administrative boundary data.

## Methodology

<!-- Replace this section with a description of how your map was created. -->

{{METHODOLOGY}}

## Data Sources

<!-- Replace this section with your actual data sources. -->

{{DATA_SOURCES}}

## License

{{LICENSE}}

## Credits

Map authored by {{AUTHOR}}
