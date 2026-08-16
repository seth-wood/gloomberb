import { LIVE_STREAM_RENEWAL_MARGIN_MS, type ResolvedLiveStream } from "../../../types/media";
import type { TvChannel } from "./channels";

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_LIVE_CANDIDATES = 6;

export interface ResolvedTvStream extends ResolvedLiveStream {
  sourceId: TvChannel["id"];
}

export interface TvLiveCandidate {
  videoId: string;
  title: string;
}

export interface TvLiveStreamInfo {
  videoId: string;
  isLive: boolean;
  title: string;
  manifestUrl?: string;
  posterUrl?: string;
  expiresAt: number;
}

export interface TvStreamResolutionSource {
  listLiveCandidates(channelId: string): Promise<readonly TvLiveCandidate[]>;
  getStreamInfo(videoId: string): Promise<TvLiveStreamInfo>;
}

export interface TvStreamResolverOptions {
  source: TvStreamResolutionSource;
  now?: () => number;
}

type YoutubeModule = typeof import("youtubei.js");
type YoutubeClient = InstanceType<YoutubeModule["Innertube"]>;

let clientPromise: Promise<YoutubeClient> | null = null;

async function getYoutubeClient(): Promise<{ client: YoutubeClient; module: YoutubeModule }> {
  const module = await import("youtubei.js");
  module.Log.setLevel(module.Log.Level.ERROR);
  clientPromise ??= module.Innertube.create({
    generate_session_locally: true,
    enable_session_cache: true,
  });
  return { client: await clientPromise, module };
}

const youtubeSource: TvStreamResolutionSource = {
  async listLiveCandidates(channelId) {
    const { client, module } = await getYoutubeClient();
    const channelFeed = await client.getChannel(channelId);
    if (!channelFeed.has_live_streams) return [];
    const liveFeed = await channelFeed.getLiveStreams();
    return liveFeed.memo
      .getType(module.YTNodes.LockupView)
      .filter((item) => item.content_type === "VIDEO")
      .slice(0, MAX_LIVE_CANDIDATES)
      .map((item) => ({
        videoId: item.content_id,
        title: item.metadata?.title?.toString() || "Live television",
      }));
  },
  async getStreamInfo(videoId) {
    const { client } = await getYoutubeClient();
    const info = await client.getBasicInfo(videoId, { client: "ANDROID" });
    const thumbnails = info.basic_info.thumbnail ?? [];
    const poster = thumbnails.reduce<(typeof thumbnails)[number] | undefined>((best, item) => {
      if (!best) return item;
      return (item.width ?? 0) * (item.height ?? 0) > (best.width ?? 0) * (best.height ?? 0) ? item : best;
    }, undefined);
    return {
      videoId,
      isLive: info.basic_info.is_live ?? false,
      title: info.basic_info.title || "Live television",
      manifestUrl: info.streaming_data?.hls_manifest_url,
      posterUrl: poster?.url,
      expiresAt: info.streaming_data?.expires?.getTime() ?? Date.now() + CACHE_TTL_MS,
    };
  },
};

export function createTvStreamResolver({
  source,
  now = Date.now,
}: TvStreamResolverOptions): (
  channel: TvChannel,
  options?: { force?: boolean },
) => Promise<ResolvedTvStream> {
  const streamCache = new Map<TvChannel["id"], ResolvedTvStream>();
  const activeResolutions = new Map<TvChannel["id"], Promise<ResolvedTvStream>>();

  const usableCachedStream = (sourceId: TvChannel["id"]): ResolvedTvStream | null => {
    const cached = streamCache.get(sourceId);
    if (!cached) return null;
    const validUntil = Math.min(cached.resolvedAt + CACHE_TTL_MS, cached.expiresAt - LIVE_STREAM_RENEWAL_MARGIN_MS);
    return now() < validUntil ? cached : null;
  };

  const resolveUncached = async (channel: TvChannel): Promise<ResolvedTvStream> => {
    const candidates = (await source.listLiveCandidates(channel.channelId)).slice(0, MAX_LIVE_CANDIDATES);
    for (const candidate of candidates) {
      try {
        const info = await source.getStreamInfo(candidate.videoId);
        if (!info.isLive || !info.manifestUrl) continue;
        const resolvedAt = now();
        return {
          provider: "youtube",
          sourceId: channel.id,
          videoId: info.videoId,
          title: info.title || candidate.title || `${channel.name} Live`,
          manifestUrl: info.manifestUrl,
          watchUrl: `https://www.youtube.com/watch?v=${info.videoId}`,
          posterUrl: info.posterUrl,
          resolvedAt,
          expiresAt: info.expiresAt || resolvedAt + CACHE_TTL_MS,
        };
      } catch {
        // YouTube can leave ended/private broadcasts in the live feed; try the next candidate.
      }
    }
    throw new Error(`${channel.name} does not currently have a playable public live stream.`);
  };

  return (channel, options) => {
    if (!options?.force) {
      const cached = usableCachedStream(channel.id);
      if (cached) return Promise.resolve(cached);
      const active = activeResolutions.get(channel.id);
      if (active) return active;
    }

    const resolution = resolveUncached(channel)
      .then((stream) => {
        streamCache.set(channel.id, stream);
        return stream;
      })
      .finally(() => {
        if (activeResolutions.get(channel.id) === resolution) {
          activeResolutions.delete(channel.id);
        }
      });
    activeResolutions.set(channel.id, resolution);
    return resolution;
  };
}

const defaultResolver = createTvStreamResolver({ source: youtubeSource });

export function resolveTvStream(
  channel: TvChannel,
  options?: { force?: boolean },
): Promise<ResolvedTvStream> {
  return defaultResolver(channel, options);
}
