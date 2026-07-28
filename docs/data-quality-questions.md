# Data Quality Questions — Guide for Creators

When you publish or update a map, the submission form now asks a short set of **optional** questions
about the source data you used to create it. This guide explains what each question means, how to answer it, and what
your answers will be used for.

Every question has plain-language options, and **"Not sure" is always a safe answer**. Clarifying questions are welcome on the submission issue or in the community [Discord Server](https://discord.gg/syG9YHMyeG).

Your answers are used to produce a provisional data-quality score. A reviewer from the [Subway Builder Modded](https://github.com/Subway-Builder-Modded) organization will then confirm it, after which the map receives one of seven quality tiers:

| Tier          | Meaning (approximate)                                                                        |
| :------------ | :------------------------------------------------------------------------------------------- |
| **Very High** | Measured, government data on both sides of the commute (residence/workplace), at fine detail |
| **High**      | Strong official data with minor gaps in coverage or at somewhat coarse granularity           |
| **Medium**    | Real official data, but potentially coarse or partial (e.g. residence side only)             |
| **Low**       | Weak or indirect anchoring in official data                                                  |
| **Very Low**  | Mostly estimated, loosely anchored to real statistics                                        |
| **Absent**    | No census or official statistics at all                                                      |
| **Unscored**  | Not yet reviewed — the default for every map                                                 |

Until a reviewer confirms a score, your map will show as **Unscored**. Answering nothing or
answering "Not sure" to everything is not penalized, so there is no downside to
filling in what you can.

The full scoring methodology used by reviewers is documented in the
[Data Quality Scoring Guidelines](https://github.com/Subway-Builder-Modded/registry/blob/main/docs/data-quality.md).
It should not be necessary to read it to submit a map, but it is linked throughout this guide if you want the
details behind any question.

---

## Grounding Rules

### Rule 1 — Answer with where the numbers are _published_, not where you _put_ them

Several questions ask for the **smallest area your numbers are reported for**. That means the area
in your **source's table** — not how finely your finished map places its demand points.

> **Example.** The statistics office publishes one employment total per municipality. You spread
> that total across the city using a fine 200m mesh. Your workplace data is **reported at
> the municipality** — so answer "whole cities or municipalities", even though your map has
> many points per municipality. The spreading you did is its own question (the _placement_ question),
> and your map will receive credit for it there.

### Rule 2 — The area-size table

Statistics are published at wildly different area sizes, and the form describes them in plain
words. Here is how those words line up with the administrative levels ("ADM") the
[full rubric](https://github.com/Subway-Builder-Modded/registry/blob/main/docs/data-quality.md#2-granularity)
uses, with examples:

| Form wording                             | Level | Examples                                         |
| :--------------------------------------- | :---- | :----------------------------------------------- |
| Uniform grid squares (~100–1000m)        | Mesh  | JP 500 m workplace mesh, PL 125 m residents grid |
| Individual buildings or census blocks    | ADM5  | US census block, TW 最小統計區                   |
| Neighborhoods or districts within a city | ADM4  | US block group, JP 町丁目                        |
| Whole cities or municipalities           | ADM3  | US city, JP 市区町村, PL gmina, CZ obec          |
| Counties or larger regions               | ADM2  | US county, CZ okres, UA район                    |
| States or provinces                      | ADM1  | US state, JP 都道府県, PL województwo            |

**Notes**:

- **Admin areas are of uneven size.** Census block groups and other fine statistical units often balloon in size in rural areas compared to more urban ones. By contrast, a uniform grid gives the same detail everywhere, which is why
  grid-based data usually scores above city-level data.
- **Grid ("mesh") data** means the office publishes a value for every square in a uniform grid laid
  over the country, regardless of admin boundaries.

---

## Workplace data

Where people **work** is the destination side of every commute, and it counts the most toward the map's final score. The submission asks three questions, covering in broad terms:
where the numbers come from, how finely they are published, and how you placed them.
(Full details: [rubric §4 — Workplace](https://github.com/Subway-Builder-Modded/registry/blob/main/docs/data-quality.md#4-workplace).)

### 1. Where do your job numbers come from?

The key distinction: does your source know where people **actually work**, or only where their
employer is **registered**?

> **Why it matters.** A worker at a rural logistics warehouse: a workplace census counts them at
> the warehouse; a business register counts them at the company's head office downtown — possibly
> in a different city entirely. Registers are real data, but they can concentrate a multi-site company's whole
> workforce onto one address.

| Option                                                                             | What it means                                                                              | Example sources                                         |
| :--------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- | :------------------------------------------------------ |
| A government census or survey that counts where people actually work               | An economic census, workplace census, or a commuting question in the national census       | JP 経済センサス, US LODES, CZ / SK census place-of-work |
| Government statistics reconstructed to actual work locations from linked records   | The statistics office cross-referenced registers to figure out physical workplaces         | LV linked-register employment data                      |
| A government business register — jobs counted at each company's registered address | Real counts, but at the declared company address (see the warehouse example above)         | EE business register                                    |
| Counts of businesses by size range, not exact job counts                           | e.g. "this area has 250 firms with under 10 staff, 50 with 10–25 staff, etc."              | Business-register size-band tables                      |
| Estimated from population or other indirect statistics                             | No direct job count, but a real published figure, scaled or redistributed, used as a proxy | Regional employment total × population share            |
| No real-world job data                                                             | Job numbers invented from building sizes or similar, with no official anchor               | OSM-only pipelines                                      |

**If unsure:** check whether the source's documentation says "place of work" (or equivalent phrasing). If present, please select the first option. If you can't tell, name the source in Methodology and the reviewer will classify it.

### 2. What is the smallest area your job numbers are reported for?

Please follow [Rule 1](#rule-1--answer-with-where-the-numbers-are-published-not-where-you-put-them):
answer with the source table's areas, not the map's demand points. Use the
[area table](#rule-2--the-area-size-table) to find the closest option.

> **Data suppression.** Census offices delete or suppress values for areas with only a handful
> of residents, for privacy. Fine-grained tables may silently lose a substantial share of their totals this way.
> **Quick check:** add up the total for the finest table you use (e.g. blocks, grid cells) and compare
> it against the official total for a bigger area. If the totals disagree by more than ~5%, your fine
> data is likely suppressed. In that case, answer with the coarsest grain that adds up, and note the
> mismatch in Methodology. (This applies to resident data as well.)

**If unsure:** open the source table and look at what one row covers. When two grains are
plausible, pick the **coarser** one and mention both in Methodology.

### 3. When a job number covers an area bigger than one building, how did you place the jobs within it?

| Option                                                                                              | What it means                                                                                                                                     |
| :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nothing to place — the data is already per building or block                                        | The source grain is already at building or block level; no spreading was required                                                                 |
| Official building footprints, split by workplace type with densities tuned to match real statistics | A cadastre or building register, where offices, factories, and shops get different job densities, calibrated against published employment figures |
| Building footprints, split by workplace type using priors                                           | Same idea, but the densities come from rules of thumb rather than the country's own data                                                          |
| Buildings split only into homes vs workplaces, then by size                                         | Jobs are kept off homes, but a warehouse and an office of equal size receive equal jobs                                                           |
| OpenStreetMap buildings, split by size                                                              | Spread over OSM footprints by floor area, with no job-density calibration                                                                         |
| Spread evenly across each area                                                                      | No building information used                                                                                                                      |

**If unsure:** describe the placement approach in Methodology; this is the question where a
brief description helps reviewers most. The
[worked country examples](https://github.com/Subway-Builder-Modded/registry/blob/main/docs/data-quality.md#7-example-countries)
in the rubric show how existing pipelines answered.

---

## Residence data

Where people **live** is the origin side of the commute. The submission asks the same three questions as for the workplace side. (Full details:
[rubric §5 — Resident](https://github.com/Subway-Builder-Modded/registry/blob/main/docs/data-quality.md#5-resident).)

### 4. What do your population numbers count?

Not all "population" is the same population:

| Option                                                         | What it means                                                                                 | Why it matters                                      |
| :------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- | :-------------------------------------------------- |
| Employed residents — people with jobs, counted where they live | Someone living in a suburb and working downtown counts as one employed resident of the suburb | Exactly the set of people who commute — the ideal   |
| Everyone of working age (roughly 15–64)                        | Includes non-workers, but tracks the commuter pool closely                                    | Slightly inflated, still well-shaped                |
| Total population, including children and retirees              | The whole suburb — often 2× or more the number of actual commuters                            | Inflated and skewed (dormitories, retirement areas) |
| No census population data                                      | Residents inferred with no official anchor                                                    | —                                                   |

**If unsure:** look for the words "employed", "economically active", or an age breakdown in your
source. A plain "population" table is almost always total population.

### 5. What is the smallest area your population numbers are reported for?

As with question 2, follow the two rules above
([Rule 1](#rule-1--answer-with-where-the-numbers-are-published-not-where-you-put-them),
[area table](#rule-2--the-area-size-table)) and account for potential data suppression.

### 6. When a population number covers an area bigger than one building, how did you place the people within it?

The residence equivalent of question 3; the main difference is that high-fidelity placement uses **dwelling
counts or residential floor area** rather than workplace types:

| Option                                                                                   | What it means                                                                                                                                                                                                                                |
| :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing to place — the data is already per building or block                             | No spreading needed                                                                                                                                                                                                                          |
| Official building footprints with per-building dwelling counts or residential floor area | A cadastre or register that records dwellings or residential floor area per building, with occupancy checked against published housing or population figures                                                                                 |
| Building footprints, with homes identified and weighted using priors                     | Buildings are classified as residential by type or shape, and people are spread among them using generic occupancy assumptions (e.g. an assumed number of residents per dwelling or per m²) rather than the country's own housing statistics |
| Buildings split only into homes vs workplaces, then by size                              | People kept out of offices, spread by building size within homes                                                                                                                                                                             |
| OpenStreetMap buildings, split by size                                                   | Spread over OSM footprints by size                                                                                                                                                                                                           |
| Spread evenly across each area                                                           | No building information used                                                                                                                                                                                                                 |

---

## Commute flows

The pairing of who commutes **from** where **to** where. This data is often hard to find, and
its absence is acceptable; a gravity model can estimate flows. What is scored is whether real flow
data (or real totals) constrain those estimates. (Full details:
[rubric §6 — O/D Shaping](https://github.com/Subway-Builder-Modded/registry/blob/main/docs/data-quality.md#6-od-shaping).)

### 7. Does the census publish data about where people commute from and to?

The idea behind the options: **estimates that are forced to add up to real, measured totals count
for more than estimates that were never checked against anything.**

| Option                                                                                                          | What it means                                                                                                                                                                                                                                                                           |
| :-------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yes — a full table of commuters between every pair of areas                                                     | The census says exactly how many people commute from each town to each other town                                                                                                                                                                                                       |
| Partial — per-area totals plus how far or where trips tend to go                                                | e.g. "40% of this town's workers stay local, 20% leave the county, 5,000 commute to the capital"                                                                                                                                                                                        |
| Only how many commute into and out of each area                                                                 | Totals per town, but no destinations or distances                                                                                                                                                                                                                                       |
| No flow data, but measured job and employed-resident totals per area that the estimates are forced to add up to | Flows start as estimates, then are rebalanced so that, for each area, the flows leaving it sum to its measured employed-resident total and the flows arriving sum to its measured job total; each individual flow remains an estimate — only the per-area totals it adds up to are real |
| No — flows are fully estimated                                                                                  | Nothing constrains the estimated flows                                                                                                                                                                                                                                                  |

**If unsure:** if you used any commuting or origin-destination table at all, describe it in
Methodology.

### 8. If you have commute-flow data, what is the smallest area it covers?

Only answer this if question 7 selected one of the first three options — it asks for the areas the
commute table's origins and destinations refer to (a table of town-to-town flows covers whole
towns). The options are the same as questions 2 and 5; use the
[area table](#rule-2--the-area-size-table). Leave it blank if there is no flow data — the grain of
estimated flows is not scored.

---

## 9. Methodology

The dropdown answers classify the data; the **Methodology** field contextualizes them.
This field is mandatory, and it is how ambiguous dropdown answers are resolved favorably rather than conservatively. A good methodology note includes:

- **Sources, with links** — the actual tables or datasets, not just the agency name.
- **The pipeline in a few sentences** — what was processed from which source, and how it became or informed demand points.
- **Anything the dropdowns don't capture** — hybrid sources, partial coverage, a suppression
  mismatch found, unusual boundary choices, etc.
- **Data vintages** — the years of the residence data, workplace data, and any special-demand figures.

Special demand (airports, hospitals, attractions, etc.) is **not scored**, but citing the figures behind
it in Methodology is appreciated.

---

## What is unscored

The following do not contribute to the final data quality score a map receives:

- **Final point density.** Merging or pruning demand points for performance is a
  rendering choice, not a data-quality issue. (This is also why
  [Rule 1](#rule-1--answer-with-where-the-numbers-are-published-not-where-you-put-them) exists.)
- **Special demand.** Attractions, hospitals, and airports are a separate, unscored layer left to the mapper's discretion. And while a well-cited special demand dataset will likely make a map more realistic, it neither raises nor lowers the tier.
- **COVID-era data.** A 2020–2021 census is still a real measurement; it is not penalized.
- **Mixed vintages.** A residence census from one year and a workplace census from another is
  common.
- **Informal employment.** Whether and how to model it is a design choice, not a scored one.

---

## What happens next

1. **Submit** (or update) the map with whatever answers you can provide.
2. **The pipeline computes a provisional score** from the responses and posts it on the submission
   with a per-pillar breakdown (workplace / residence / flows), pending review.
3. **A reviewer confirms it** — sometimes adjusting a classification, sometimes asking a clarifying
   question. The Methodology field is what keeps this step accurate.
4. **The map receives its tier.** Until confirmation, it shows as **Unscored**.

Answers are stored alongside the map in the registry
(`maps/<map-id>/data-quality.json`), so the score is auditable and can be revisited. To revise
answers later (e.g. if you have found better data), submit a map-update issue with the changed answers or open a pull request against that file directly.

If you have any questions about this document, please ask in the
community [Discord Server](https://discord.gg/syG9YHMyeG) or on your submission issue.
