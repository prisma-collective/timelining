import {
  channelSpecForTopic,
  resolveRouteForTopic,
  resolveTopics,
} from '@organising-config';

describe('organising config aliases', () => {
  it('resolves primary resource topic', () => {
    const spec = channelSpecForTopic('_botRecursos');
    expect(spec?.key).toBe('enact');
    expect(spec?.channelKey).toBe('resources');
    expect(resolveRouteForTopic('_botRecursos')).toEqual({
      domain: 'enact.prisma.events',
      path: '/api/webhook/resolve/resource',
    });
  });

  it('resolves alias resource topic to same route', () => {
    const spec = channelSpecForTopic('_botResources');
    expect(spec?.key).toBe('enact');
    expect(spec?.channelKey).toBe('resources');
    expect(resolveRouteForTopic('_botResources')).toEqual({
      domain: 'enact.prisma.events',
      path: '/api/webhook/resolve/resource',
    });
  });

  it('includes alias topics in resolveTopics', () => {
    expect(resolveTopics()).toEqual(
      expect.arrayContaining(['_botRecursos', '_botResources'])
    );
  });
});
