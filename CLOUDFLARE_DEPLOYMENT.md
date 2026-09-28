# Cloudflare deployment

`npm run build` writes the static Vite site and a bundled Cloudflare module worker to `dist/_worker.js`. The worker serves static assets through the `ASSETS` binding and handles only `POST /api/official-source`; `dist/_routes.json` limits the Pages advanced-mode worker route to that endpoint.

For Cloudflare Workers with Static Assets, deploy with the checked-in `wrangler.jsonc`; `run_worker_first` routes the endpoint through the worker while other requests use the static asset binding. The generated `.assetsignore` prevents worker routing files from being served as public assets.

For Cloudflare Pages, use the build output directory `dist` and advanced mode so Pages loads `dist/_worker.js` and `dist/_routes.json`. The project owner should confirm which Cloudflare product currently publishes `accounting.zxxmore.trade` and apply the matching setup before deploying. The endpoint is same-origin and has no CORS allowance.
