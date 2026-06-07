export type OrganisingKey = 'enact' | 'evaluate' | 'enrol' | 'envision';

export interface OrganisingChannelConfig {
  domain: string;
  channel: string;
}

export const ORGANISING_CONFIG = {
  enact: {
    domain: 'enact.prisma.events',
    channel: '_botEnaction',
  },
  evaluate: {
    domain: 'evaluate.prisma.events',
    channel: '_botEvaluation',
  },
  enrol: {
    domain: 'enrol.prisma.events',
    channel: '_botEnrolment',
  },
  envision: {
    domain: 'envision.prisma.events',
    channel: '_botEnvisioning',
  },
} as const satisfies Record<OrganisingKey, OrganisingChannelConfig>;

export const TELEGRAM_MESSAGES_QUEUE = 'telegram_messages';

export function organisingQueueKey(key: OrganisingKey): string {
  return `timelining::organising::${key}`;
}
