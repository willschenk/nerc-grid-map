# Stock ticker label guidance

Use a very distinctive public-company stock ticker as a parent label only when it is widely recognizable, unambiguous in the map context, and clearer than the long parent company name.

Good use:

- `XOM Baton Rouge` for `ExxonMobil Corp - Baton Rouge`
- `XOM Beaumont` for `ExxonMobil Oil Corporation - Beaumont Refinery`

Rules:

- Use the ticker as a parent prefix with a meaningful site, region, or function suffix.
- Do not use a stock ticker by itself when it would be unclear which registered record it represents.
- Do not replace better grid/utility labels, ISO/RTO labels, BA/LBA codes, OASIS codes, or project-owner supplied area codes.
- Do not replace `DEC`, `DEP`, `ALTE`, `ALTW`, `CPLE`, `CPLW`, `CIN`, `YAD`, or similar grid-specific labels with holding-company tickers.
- Do not use a ticker when the operating-company acronym is more useful to grid users.
- Keep the readable company or project name in `short` or `normal`.

Treat ticker labels as `shortest_type: "acronym"` or `shortest_type: "parent_project"`, depending on whether the label is the ticker alone or ticker plus site/project suffix. Use `shortest_source: "public_filing"`, `"official_website"`, or `"user_provided"` as appropriate.
