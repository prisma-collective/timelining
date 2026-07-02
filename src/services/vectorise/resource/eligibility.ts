export const YOUTUBE_ELIGIBLE_WHERE = `
  r.sourceKind = 'youtube'
  AND r.youtubeVideoId IS NOT NULL
`;
