export type OrganisingKey = 'enact' | 'evaluate' | 'enrol' | 'envision';

export interface OrganisingResolveRoute {
  path: string;
}

export interface OrganisingChannel {
  channel: string;
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
        resolve: { path: '/api/webhook/resolve/schedule' },
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

export interface OrganisingChannelSpec {
  key: OrganisingKey;
  channelKey: string;
  domain: string;
  channel: string;
  resolve?: OrganisingResolveRoute;
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
        ...(spec.resolve ? { resolve: spec.resolve } : {}),
      };
    }
  }
}

export function organisingKeyForTopic(topic: string): OrganisingKey | null {
  for (const spec of allChannelSpecs()) {
    if (spec.channel === topic) {
      return spec.key;
    }
  }
  return null;
}

export function organisingDomainForTopic(topic: string | null | undefined): string | null {
  if (!topic) {
    return null;
  }

  for (const spec of allChannelSpecs()) {
    if (spec.channel === topic) {
      return spec.domain;
    }
  }

  return null;
}

export function resolveRouteForTopic(
  topic: string | null | undefined
): { domain: string; path: string } | null {
  if (!topic) {
    return null;
  }

  for (const spec of allChannelSpecs()) {
    if (spec.channel === topic && spec.resolve) {
      return { domain: spec.domain, path: spec.resolve.path };
    }
  }

  return null;
}

export function resolveTopics(): string[] {
  const topics: string[] = [];
  for (const spec of allChannelSpecs()) {
    if (spec.resolve) {
      topics.push(spec.channel);
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
