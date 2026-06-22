This is the **Locked In** web app (v4) — a [Next.js](https://nextjs.org) frontend
bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
It talks to the Fastify backend and the single on-chain `locked_in` Anchor
program (custody vault + community pot, separated only by PDA seeds).

## Getting Started

First, run the development server:

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

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment & RPC

Cluster profiles are switched with `scripts/use-cluster.sh` (devnet/mainnet),
which writes the appropriate `.env.*` values. All `.env`/`.env.*` files are
gitignored; see `.env.example` for the keys.

The frontend reads `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_RPC_URL`,
and `NEXT_PUBLIC_SOLANA_WS_URL`, and falls back to the **public** Solana RPC
(`https://api.<cluster>.solana.com`) when they are unset. The dedicated Alchemy
RPC lives only in the backend (`SOLANA_RPC_URL`, server-side) and must **never**
be placed in a `NEXT_PUBLIC_` variable, since that would ship the key to the
browser.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
