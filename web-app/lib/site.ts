const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const SITE_ORIGIN = configuredSiteUrl
  ? new URL(configuredSiteUrl).origin
  : 'https://www.lockedin.quest';
