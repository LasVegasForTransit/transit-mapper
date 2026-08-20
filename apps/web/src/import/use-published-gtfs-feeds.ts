import { useEffect, useState } from 'react';
import type { PublishedGtfsFeed } from '@transitmapper/core/model/gtfs-feed';
import { loadPublishedGtfsFeeds } from './stream-gtfs-feed';

export interface PublishedGtfsFeedState {
  feeds: PublishedGtfsFeed[];
  selectedFeed: PublishedGtfsFeed | undefined;
  selectedSlug: string;
  setSelectedSlug: (slug: string) => void;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function usePublishedGtfsFeeds(): PublishedGtfsFeedState {
  const [feeds, setFeeds] = useState<PublishedGtfsFeed[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const availableFeeds = await loadPublishedGtfsFeeds();
        if (!active) return;
        setFeeds(availableFeeds);
        setSelectedSlug((current) =>
          availableFeeds.some((feed) => feed.slug === current)
            ? current
            : (availableFeeds[0]?.slug ?? ''),
        );
      } catch (loadError) {
        if (!active) return;
        setFeeds([]);
        setSelectedSlug('');
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Published transit feeds are unavailable.',
        );
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [request]);

  return {
    feeds,
    selectedFeed: feeds.find((feed) => feed.slug === selectedSlug),
    selectedSlug,
    setSelectedSlug,
    loading,
    error,
    retry: () => setRequest((current) => current + 1),
  };
}
