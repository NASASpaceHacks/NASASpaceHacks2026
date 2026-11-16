# Marswalk landing page

The project page for the NASA Space Apps 2026 submission. Static HTML, no build tools or dependencies.

## Edit links (video, slides, team)
Change `js/config.js` only:
- `video`: the 30-second film URL (YouTube/Vimeo). `videoEmbed`: its embed URL, e.g. `https://www.youtube-nocookie.com/embed/<id>`.
- `slides`: `slides/`, the built-in slide viewer (`slides/index.html` reads `slides/slides.json` and `slides/img/NN.webp`). The PDF is `files/marswalk-slides.pdf`. The deck's source is the team's Slides artifact; to update, re-render each slide to 1920×1080 PNG, save 1600×900 `NN.webp` plus 480×270 `tNN.webp`, and list them in `slides.json`.
- `MW_TEAM`: `[{ name: '…', role: '…' }]` adds the team list to the footer.

An empty link shows as "soon" (disabled).

## Edit content
Sources live in `src/`: `head.html`, `hero.html` (the orbit-to-boots descent), `sections/*.html` (one file per section, assembled in name order), `foot.html`. Design tokens and shared components are in `styles/base.css`.

After editing anything in `src/`, rebuild `index.html`:
```sh
node build.mjs
```

## Preview
```sh
python3 -m http.server 4173   # then open http://localhost:4173
```
The globe reads image pixels, so open the page over http, not file://.

## Deploy
Live at **https://marswalk-gale.vercel.app** (also https://marswalk-two.vercel.app). Vercel project `marswalk`; both domains follow every production deploy.
```sh
node build.mjs && npx vercel@latest deploy --prod --yes   # from this folder
```

## Data and credits
All imagery is real NASA data: HiRISE (NASA/JPL/University of Arizona), Curiosity Mastcam/Navcam (NASA/JPL-Caltech/MSSS), Viking MDIM 2.1 (NASA/USGS via JPL Mars Trek), and USGS Gale merged DEM contours (Parker & Calef 2016). The AR navigator screenshots are the real app on real Gale terrain, with the camera feed replaced by a Curiosity Mastcam photo.

## Files
- `files/marswalk-slides.pdf`: the 10-slide pitch deck.
- `files/marswalk-concept-study.pdf`: a copy of the team's hardware concept report (`Mars Walk Design Concept Report.pdf` at the repo root).
- The research paper is linked from GitHub (`docs/paper/marswalk-paper.pdf`), not copied here.
