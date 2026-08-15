import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), 'utf8');
}

describe('public privacy disclosure', () => {
  it('ships as a semantic no-JavaScript document with the complete sampling boundary', () => {
    const privacy = source('privacy.html');
    const text = privacy.replace(/\s+/g, ' ');

    expect(privacy).toMatch(/<main[\s>]/);
    expect(privacy).toMatch(/<h1[^>]*>Privacy/i);
    expect(privacy).toMatch(/<time[^>]+2026-08-13/);
    expect(privacy).toContain('Las Vegans for Better Transit');
    expect(privacy).toMatch(/Cloudflare/i);
    expect(privacy).toMatch(/D1/);
    expect(privacy).toMatch(/1%/);
    expect(privacy).toMatch(/5%/);
    expect(privacy).toMatch(/first 24 hours/i);
    expect(text).toMatch(/speed and reliability/i);
    expect(privacy).toMatch(/Global Privacy Control/i);
    expect(privacy).toMatch(/Do Not Track/i);
    expect(privacy).toMatch(/seven days/i);
    expect(privacy).toMatch(/90 days/i);
    expect(privacy).toMatch(/Time Travel/i);
    expect(privacy).toMatch(/INP[^<]*duration/i);
    expect(privacy).toMatch(/never collect/i);
    expect(privacy).toMatch(/routes/i);
    expect(privacy).toMatch(/stations/i);
    expect(privacy).toMatch(/coordinates/i);
    expect(privacy).toMatch(/raw IP/i);
    expect(privacy).toMatch(/persistent identifier/i);
    expect(privacy).toContain('https://www.cloudflare.com/privacypolicy/');
    expect(privacy).toContain('https://github.com/LasVegasForTransit/transit-mapper');
    expect(privacy).not.toMatch(/<script\b/i);
  });

  it('publishes privacy in the sitemap without adding it to the editor precache', () => {
    const sitemap = source('public/sitemap.xml');
    const viteConfig = source('vite.config.ts');

    expect(sitemap).toContain('<loc>https://map.lasvegasfortransit.org/privacy</loc>');
    expect(viteConfig).toMatch(/privacy:\s*'privacy\.html'/);
    expect(viteConfig).toMatch(/globIgnores:\s*\[[^\]]*'privacy\.html'/s);
    expect(source('index.html')).not.toContain('privacy.html');
    expect(source('src/main.tsx')).not.toContain('privacy.html');
  });

  it('links privacy beside the embed credit without relying on JavaScript', () => {
    const embed = source('embed.html');

    expect(embed).toMatch(/<a[^>]+id="embed-open"/);
    expect(embed).toMatch(/<a[^>]+href="\/privacy"[^>]*>Privacy<\/a>/);
  });
});
