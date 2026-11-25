// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';
import starlightLlmsTxt from 'starlight-llms-txt';
import remarkMermaid from './src/plugins/remark-mermaid.mjs';

// Home page and demo are plain Astro pages in src/pages; Starlight owns /docs/.
// The docs pages themselves are generated from the jargo repo by
// scripts/sync-docs.mjs into src/content/docs/docs/.
export default defineConfig({
  site: 'https://gojargo.dev',
  trailingSlash: 'always',
  markdown: { remarkPlugins: [remarkMermaid] },
  integrations: [
    starlight({
      title: 'jargo',
      description: 'Real-time voice agents in Go, for the browser, phone, LiveKit and WhatsApp.',
      logo: { src: './src/assets/logo.png', replacesTitle: false },
      favicon: '/favicon.png',
      components: {
        MarkdownContent: './src/components/starlight/MarkdownContent.astro',
        SocialIcons: './src/components/starlight/SocialIcons.astro',
      },
      // Share image for the docs pages (Starlight sets the rest of the tags).
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://gojargo.dev/og.png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://gojargo.dev/og.png' } },
      ],
      // llms.txt, llms-full.txt and llms-small.txt, so AI assistants can read
      // the docs as plain text.
      plugins: [
        // The blog at /blog/, with an RSS feed at /blog/rss.xml.
        starlightBlog({
          title: 'Blog',
          prefix: 'blog',
          postCount: 10,
          recentPostCount: 5,
          metrics: { readingTime: true },
          authors: {
            fallais: { name: 'fallais', url: 'https://github.com/fallais' },
          },
        }),
        starlightLlmsTxt({
          projectName: 'jargo',
          description:
            'jargo is a Go framework for real-time voice agents: audio in over WebRTC, WebSocket, LiveKit or Twilio, a streaming speech-to-text, LLM and text-to-speech pipeline (or a speech-to-speech model) with turn-taking and barge-in, and audio back out. The build is cgo-free.',
          details:
            'Install with `go get github.com/gojargo/jargo`. The API reference is on pkg.go.dev, and runnable examples live in the examples/ directory of the repository.',
          optionalLinks: [
            { label: 'Go reference', url: 'https://pkg.go.dev/github.com/gojargo/jargo', description: 'API reference for every package.' },
            { label: 'Examples', url: 'https://github.com/gojargo/jargo/tree/main/examples', description: 'Runnable bots, from one spoken sentence to a full voice agent.' },
            { label: 'Changelog', url: 'https://github.com/gojargo/jargo/blob/main/CHANGELOG.md', description: 'Notable and breaking changes by release.' },
          ],
          promote: ['docs', 'docs/getting-started/**', 'docs/concepts/**'],
          demote: ['docs/benchmarks'],
        }),
      ],
      customCss: ['@fontsource-variable/inter', './src/styles/docs.css'],
      lastUpdated: false,
      sidebar: [
        { label: 'Overview', link: '/docs/' },
        { label: 'Getting started', items: [{ autogenerate: { directory: 'docs/getting-started' } }] },
        { label: 'Concepts', items: [{ autogenerate: { directory: 'docs/concepts' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'docs/guides' } }] },
        { label: 'Extending', items: [{ autogenerate: { directory: 'docs/extending' } }] },
        { label: 'Deploy', items: [{ autogenerate: { directory: 'docs/deploy' } }] },
        { label: 'Benchmarks', link: '/docs/benchmarks/' },
        {
          label: 'More',
          items: [
            { label: 'Go reference', link: 'https://pkg.go.dev/github.com/gojargo/jargo', attrs: { target: '_blank' } },
            { label: 'Examples', link: 'https://github.com/gojargo/jargo/tree/main/examples', attrs: { target: '_blank' } },
            { label: 'Changelog', link: 'https://github.com/gojargo/jargo/blob/main/CHANGELOG.md', attrs: { target: '_blank' } },
            { label: 'Blog', link: '/blog/' },
            { label: 'Demo', link: '/#demo' },
          ],
        },
      ],
    }),
  ],
});
