import { httpRequest } from '../httpClient';
import type {
  ArenaAnswerResponse,
  ArenaCreatedMatch,
  ArenaLadderRow,
  ArenaMatchState,
  ArenaProfile,
  ArenaQueueState,
  ArenaStartResponse,
  ArenaSeason,
  ArenaStakeEntry,
  ArenaStakeResult,
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

// ---------- Stake seasons ----------

/** The open season, or null between seasons. Public — no auth needed. */
export function getSeason(): Promise<ArenaSeason | null> {
  return httpRequest<ArenaSeason | null>('/v1/arena/season');
}

/** This wallet's most recent stake entry, or null if they have never staked. */
export function getMyStake(token: string): Promise<ArenaStakeEntry | null> {
  return httpRequest<ArenaStakeEntry | null>('/v1/arena/stake', { token });
}

/**
 * Stake one course lock on the open season. Binding is immediate and there is
 * no early exit, so the caller must confirm before calling this.
 */
export function stakeSeason(
  token: string,
  courseId: string,
  consentVersion: string,
): Promise<ArenaStakeResult> {
  return httpRequest<ArenaStakeResult>('/v1/arena/stake', {
    method: 'POST',
    token,
    body: { courseId, consentVersion },
  });
}

/**
 * Courses this wallet could stake right now. Served by the same check the
 * opt-in gate runs, so the picker cannot offer something the gate refuses.
 */
export function getStakeableCourses(token: string): Promise<{ courseIds: string[] }> {
  return httpRequest<{ courseIds: string[] }>('/v1/arena/stake/eligible', { token });
}

// ---------- Queue proposals ----------

export interface ArenaProposal {
  matchId: string;
  msLeft: number;
  accepted: boolean;
  opponentAccepted: boolean;
  opponent: string | null;
}

/** The offer currently in front of this wallet, or null. */
export function getProposal(token: string): Promise<ArenaProposal | null> {
  return httpRequest<ArenaProposal | null>('/v1/arena/proposal', { token });
}

export function acceptProposal(token: string, matchId: string): Promise<{ matchId: string; ready: boolean }> {
  return httpRequest<{ matchId: string; ready: boolean }>(
    `/v1/arena/proposal/${encodeURIComponent(matchId)}/accept`, { method: 'POST', token });
}

export function declineProposal(token: string, matchId: string): Promise<{ declined: boolean }> {
  return httpRequest<{ declined: boolean }>(
    `/v1/arena/proposal/${encodeURIComponent(matchId)}/decline`, { method: 'POST', token });
}
