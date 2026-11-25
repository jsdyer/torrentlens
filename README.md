# Torrent Lens

A private browser workbench for inspecting `.torrent` metadata and magnet links at
[CoolCode](https://coolcode.ca/torrentlens/). No tracker connections, peer connections,
payload downloads, API credentials or server are required.

<!-- coolcode:guide -->
Drop a .torrent file to see its declared files, sizes, tracker addresses and exact infohashes. A magnet normally supplies only identifiers and hints; Torrent Lens does not fetch its missing file list. Filename warnings help you review metadata but are not a malware or authenticity verdict.
<!-- /coolcode:guide -->

## Use it

Choose a `.torrent` file, drag one onto the input, or paste a magnet link. The local
example is synthetic metadata for `readme.txt`, with an example.org tracker that is
never contacted. Filter filenames or show only flagged entries; download a JSON
report if you want to keep the result. Clear removes the current input and result.

- **v1:** SHA-1 of the original encoded `info` bytes, single/multifile layouts,
  declared payload and padding, private flag, piece length and piece-count checks.
- **v2:** SHA-256 of original encoded `info` bytes, file-tree layouts, piece-root
  presence/length warnings. Hybrid torrents show both hashes and compare layout totals.
- **Magnet:** hexadecimal/base32 v1 hashes and SHA-256 multihash v2 identifiers;
  display name/size are labelled unverified hints. Unsupported/conflicting hashes
  produce clear errors.
- **Review:** executable/script extensions, misleading double extensions, unsafe
  path components, bidi controls, Windows filename conflicts, duplicate/case-colliding
  paths and symbolic-link attributes.
- Tracker and web-seed URLs are inert text. Private tracker URLs may contain passkeys;
  inspect your report before sharing it.

Metadata can lie. The inspector does not scan payloads, verify publishers, validate
v2 Merkle piece layers, assess copyright status, establish seeder counts, or resolve
magnet metadata. Hashes identify the `info` dictionary, not every top-level field.

## Privacy and safety limits

A module Web Worker performs inspection and hashing. No files, links or reports are
sent to a server or retained in browser storage. The normal CoolCode aggregate
page-open counter receives the tool ID, never the file, magnet or report. The UI
uses text nodes for untrusted values. Hashing needs HTTPS or localhost.

The strict bencode parser rejects duplicate/out-of-order dictionary keys, noncanonical
integers, trailing bytes, truncation and unsupported metadata versions. It bounds
input bytes, recursion, metadata nodes and file counts. File sizes use integer
arithmetic, including values larger than JavaScript's safe Number range. Displayed
binary-unit sizes are abbreviated; exact byte counts remain in the JSON report.

## Expand or customize

Edit `web/config.mjs` to change the local limits or file-list page size. Defaults:
16 MiB metadata, depth 64, 250,000 metadata nodes, 50,000 files, 100 rows per page,
100,000-character magnets. The UI worker also has a 20-second execution timeout in
`web/app.mjs`. Raising limits increases local memory/CPU use. The parser accepts any
valid file layout within those bounds; there is no catalogue or starter-item limit.

Change `fileFlags` in `web/model.mjs` to add a documented review rule. Add a meaningful
fixture/test for that rule. No data refresh or schedule is needed: push reviewed
source changes after the checks below.

## Develop and publish

Python 3.12+ and Node 24+ are sufficient; there are no app runtime packages.

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
```

`dist/` is generated and ignored. `.github/workflows/pages.yml` checks unit tests,
builds offline, runs the updated Playwright browser check in CI and deploys successful
`main` builds to GitHub Pages. Set Pages' source to **GitHub Actions**. PRs do not deploy.
No CNAME is needed. The page uses relative asset paths and works under `/torrentlens/`.

`tool.json` is the reviewable catalogue record. Hub catalogue, Worker registry,
watchdog inventory and sitemap integration are managed separately; this app has
**no collector, no freshness timestamp and no scheduled refresh**. Do not interpret
its page build date as a source-data check.

## Sources and licence

Protocol references: [BEP 3](https://www.bittorrent.org/beps/bep_0003.html),
[BEP 9](https://www.bittorrent.org/beps/bep_0009.html),
[BEP 52](https://www.bittorrent.org/beps/bep_0052.html).
Application source: MIT; see `LICENSE`.
