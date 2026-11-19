import "server-only";

import { NextResponse } from "next/server";

export type ServerKeyName = "SEOUL_API_KEY" | "DATA_GO_KR_API_KEY" | "KAKAO_REST_API_KEY";

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export function serverKey(name: ServerKeyName): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ApiFailure(`서버 환경변수 ${name}이 설정되지 않았습니다.`, 503);
  }
  return value;
}

export function errorResponse(error: unknown) {
  const failure = error instanceof ApiFailure ? error : new ApiFailure("외부 데이터 제공자에 연결하지 못했습니다.");
  return NextResponse.json(
    { error: { message: failure.message } },
    { status: failure.status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function providerJson<T>(url: URL, init?: RequestInit & { revalidate?: number }): Promise<T> {
  const { revalidate = 60, ...requestInit } = init ?? {};
  let response: Response;
  try {
    response = await fetch(url, {
      ...requestInit,
      signal: requestInit.signal ?? AbortSignal.timeout(8_000),
      next: { revalidate },
    });
  } catch {
    throw new ApiFailure("외부 데이터 제공자에 연결하지 못했습니다.");
  }
  if (response.status === 401) throw new ApiFailure("외부 데이터 제공자 인증에 실패했습니다. 서버 API 키를 확인해 주세요.", 502);
  if (response.status === 403) throw new ApiFailure("외부 데이터 제공자가 접근을 거부했습니다. API 권한 또는 호출 IP 설정을 확인해 주세요.", 502);
  if (response.status === 429) throw new ApiFailure("외부 데이터 제공자의 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.", 429);
  if (!response.ok) throw new ApiFailure(`외부 데이터 제공자가 HTTP ${response.status} 오류를 반환했습니다.`);
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const code = body.match(/<CODE>\s*([^<]+)\s*<\/CODE>/i)?.[1]?.trim();
    const message = body.match(/<MESSAGE>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/MESSAGE>/i)?.[1]?.trim() ?? "";
    if (code === "INFO-100" && /인증키|인증|키가 유효하지/.test(message)) {
      throw new ApiFailure("서울시 API 인증에 실패했습니다. SEOUL_API_KEY가 유효한지와 서비스 신청 상태를 확인해 주세요.", 502);
    }
    throw new ApiFailure(code ? `외부 데이터 API 오류 (${code}).` : "외부 데이터 응답을 읽을 수 없습니다.");
  }
}

export function validCoordinate(value: string | null, min: number, max: number): number | null {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
