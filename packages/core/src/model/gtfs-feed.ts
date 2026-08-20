/** Public metadata for one server-managed GTFS archive. The upstream URL is
 * deliberately absent because only the Worker refresh pipeline may fetch it. */
export interface PublishedGtfsFeed {
  slug: string;
  name: string;
  region: string;
}

export interface PublishedGtfsFeedsResponse {
  feeds: PublishedGtfsFeed[];
}
