# Incremental Documentation

![Incremental Banner](./banner.png)

**Incremental Compute Engine — developer documentation.**

This site is the complete end-to-end documentation for the Incremental incremental compute engine. It runs on TanStack Start and deploys to Cloudflare Workers.

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The app uses TanStack Start and fumadocs. Edit the files under `src/routes` and the MDX pages under `content/`; the page auto-updates.

Production commands:

```bash
bun run build
bun run preview
bun run deploy
```

## Learn More

- [TanStack Start documentation](https://tanstack.com/start)
- [Cloudflare Workers guide](https://developers.cloudflare.com/workers/)
- [Cloudflare Vite plugin documentation](https://developers.cloudflare.com/workers/vite-plugin/)
- [fumadocs documentation](https://fumadocs.vercel.app)
