export type OrganisingKey = 'enact' | 'evaluate' | 'enrol' | 'envision';

export type ForwardMode = 'all' | 'replies_only' | 'none';

export interface OrganisingForwardRoute {
  mode: ForwardMode;
  path: string;
}

export interface OrganisingResolveRoute {
  path: string;
}

export interface OrganisingChannel {
  channel: string;
  aliases?: string[];
  forward?: OrganisingForwardRoute;
  resolve?: OrganisingResolveRoute;
}

export interface OrganisingAppConfig {
  domain: string;
  channels: Record<string, OrganisingChannel>;
}

export const ORGANISING_CONFIG = {
  enact: {
    domain: 'enact.prisma.events',
    channels: {
      decide: {
        channel: '_botDecidir',
        resolve: { path: '/api/webhook/resolve/decide' },
      },
      schedule: {
        channel: '_botAgendar',
        forward: { mode: 'replies_only', path: '/api/webhook/resolve/schedule/update' },
        resolve: { path: '/api/webhook/resolve/schedule' },
      },
      resources: {
        channel: '_botRecursos',
        aliases: ['_botResources'],
        resolve: { path: '/api/webhook/resolve/resource' },
      },
    },
  },
  evaluate: {
    domain: 'evaluate.prisma.events',
    channels: {
      evaluation: {
        channel: '_botEvaluation',
      },
    },
  },
  enrol: {
    domain: 'register.prisma.events',
    channels: {
      enrolment: {
        channel: '_botEnrolment',
        forward: { mode: 'all', path: '/api/webhook' },
        resolve: { path: '/api/webhook/resolve' },
      },
    },
  },
  envision: {
    domain: 'envision.prisma.events',
    channels: {
      envisioning: {
        channel: '_botEnvisioning',
      },
    },
  },
} as const satisfies Record<OrganisingKey, OrganisingAppConfig>;

/** Redis queue for Neo4j entry ingest (all _bot* Telegram messages). */
export const INGEST_BACKLOG_QUEUE = 'timelining::ingest::backlog';
export const INGEST_FAILED_QUEUE = 'timelining::ingest::failed';
export const TRANSCRIBE_FAILED_QUEUE = 'timelining::transcribe::failed';
export const RESOLVE_FAILED_QUEUE = 'timelining::resolve::failed';

export interface OrganisingChannelSpec {
  key: OrganisingKey;
  channelKey: string;
  domain: string;
  channel: string;
  forward?: OrganisingForwardRoute;
  resolve?: OrganisingResolveRoute;
}

function channelMatchesTopic(channelSpec: OrganisingChannel, topic: string): boolean {
  if (channelSpec.channel === topic) {
    return true;
  }
  return channelSpec.aliases?.includes(topic) ?? false;
}

export function* allChannelSpecs(): Generator<OrganisingChannelSpec> {
  for (const key of Object.keys(ORGANISING_CONFIG) as OrganisingKey[]) {
    const app = ORGANISING_CONFIG[key];
    for (const [channelKey, spec] of Object.entries(app.channels)) {
      yield {
        key,
        channelKey,
        domain: app.domain,
        channel: spec.channel,
        ...(spec.forward ? { forward: spec.forward } : {}),
        ...(spec.resolve ? { resolve: spec.resolve } : {}),
      };
    }
  }
}

export function channelSpecForTopic(
  topic: string | null | undefined
): OrganisingChannelSpec | null {
  if (!topic) {
    return null;
  }

  for (const key of Object.keys(ORGANISING_CONFIG) as OrganisingKey[]) {
    const app = ORGANISING_CONFIG[key];
    for (const [channelKey, spec] of Object.entries(app.channels)) {
      if (channelMatchesTopic(spec, topic)) {
        return {
          key,
          channelKey,
          domain: app.domain,
          channel: spec.channel,
          ...(spec.forward ? { forward: spec.forward } : {}),
          ...(spec.resolve ? { resolve: spec.resolve } : {}),
        };
      }
    }
  }

  return null;
}

export function organisingKeyForTopic(topic: string): OrganisingKey | null {
  return channelSpecForTopic(topic)?.key ?? null;
}

export function organisingDomainForTopic(topic: string | null | undefined): string | null {
  return channelSpecForTopic(topic)?.domain ?? null;
}

export function shouldForwardToSibling(
  mode: ForwardMode | undefined,
  isReply: boolean
): boolean {
  if (mode === 'all') {
    return true;
  }
  if (mode === 'replies_only') {
    return isReply;
  }
  return false;
}

export function forwardRouteForTopic(
  topic: string | null | undefined
): { domain: string; path: string; mode: ForwardMode } | null {
  const spec = channelSpecForTopic(topic);
  if (!spec?.forward || spec.forward.mode === 'none') {
    return null;
  }

  return {
    domain: spec.domain,
    path: spec.forward.path,
    mode: spec.forward.mode,
  };
}

export function resolveRouteForTopic(
  topic: string | null | undefined
): { domain: string; path: string } | null {
  const spec = channelSpecForTopic(topic);
  if (!spec?.resolve) {
    return null;
  }

  return {
    domain: spec.domain,
    path: spec.resolve.path,
  };
}

export function resolveTopics(): string[] {
  const topics: string[] = [];
  for (const key of Object.keys(ORGANISING_CONFIG) as OrganisingKey[]) {
    for (const spec of Object.values(ORGANISING_CONFIG[key].channels)) {
      if (spec.resolve) {
        topics.push(spec.channel);
        if (spec.aliases) {
          topics.push(...spec.aliases);
        }
      }
    }
  }
  return topics;
}

export function buildOrganisingResolveUrl(
  domain: string,
  path: string,
  entryId: string
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `https://${domain}${normalizedPath}?entryId=${encodeURIComponent(entryId)}`;
}
