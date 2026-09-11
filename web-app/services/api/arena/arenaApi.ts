import { httpRequest } from '../httpClient';
import type {
  ArenaAnswerResponse,
  ArenaCreatedMatch,
  ArenaLadderRow,
  ArenaMatchState,
  ArenaProfile,
  ArenaQueueState,
  ArenaStartResponse,
} from '../../../types/arena';

export function createChallenge(token: string): Promise<ArenaCreatedMatch> {
  return httpRequest<ArenaCreatedMatch>('/v1/arena/matches', { method: 'POST', token });
}

export function joinByCode(token: string, code: string): Promise<{ matchId: string }> {
  return httpRequest<{ matchId: string }>(
    `/v1/arena/join/${encodeURIComponent(code)}`,
    { method: 'POST', token },
  );
}

export function getMatch(token: string, matchId: string): Promise<ArenaMatchState> {
  return httpRequest<ArenaMatchState>(
    `/v1/arena/matches/${encodeURIComponent(matchId)}`,
    { token },
  );
}

export function startMatch(token: string, matchId: string): Promise<ArenaStartResponse> {
  return httpRequest<ArenaStartResponse>(
    `/v1/arena/matches/${encodeURIComponent(matchId)}/start`,
    { method: 'POST', token },
  );
}

export function nextQuestion(token: string, matchId: string): Promise<ArenaStartResponse> {
  return httpRequest<ArenaStartResponse>(
    `/v1/arena/matches/${encodeURIComponent(matchId)}/question`,
    { token },
  );
}

/**
 * `chosenOptionId` is null when the 20s timer ran out. The server scores that
 * as incorrect at the full cap — it never trusts a client-reported duration.
 */
export function answerQuestion(
  token: string,
  matchId: string,
  questionId: string,
  chosenOptionId: string | null,
): Promise<ArenaAnswerResponse> {
  return httpRequest<ArenaAnswerResponse>(
    `/v1/arena/matches/${encodeURIComponent(matchId)}/answer`,
    { method: 'POST', token, body: { questionId, chosenOptionId } },
  );
}

export function getLadder(limit = 100): Promise<ArenaLadderRow[]> {
  return httpRequest<ArenaLadderRow[]>(`/v1/arena/ladder?limit=${limit}`);
}

export function getMyArena(token: string): Promise<ArenaProfile> {
  return httpRequest<ArenaProfile>('/v1/arena/me', { token });
}

export function enterQueue(token: string): Promise<ArenaQueueState> {
  return httpRequest<ArenaQueueState>('/v1/arena/queue', { method: 'POST', token });
}

export function pollQueue(token: string): Promise<ArenaQueueState> {
  return httpRequest<ArenaQueueState>('/v1/arena/queue', { token });
}

// POST rather than DELETE: the shared httpClient only speaks GET/POST.
export function leaveQueue(token: string): Promise<{ left: boolean }> {
  return httpRequest<{ left: boolean }>('/v1/arena/queue/leave', { method: 'POST', token });
}
