import { NextResponse } from "next/server";
import { ApiFailure, errorResponse, serverKey, validCoordinate } from "@/lib/server/providers";

type RouteMode = "BIKE_ONLY" | "SHORTEST";
type KakaoPoint = [number, number];
type KakaoRouteResponse = {
  status?: string;
  route?: {
    properties?: { totalDistance?: number; totalTime?: number; landingUrl?: string };
    legs?: Array<{ steps?: Array<{ properties?: { guidance?: string; distance?: number; time?: number }; path?: { points?: KakaoPoint[] } }> }>;
  };
};

const statusMessages: Record<string, string> = {
  SAME_POINT: "출발지와 목적지가 같습니다.",
  START_LINK_NOT_FOUND: "선택한 대여소 주변에서 자전거 경로를 찾지 못했습니다.",
  END_LINK_NOT_FOUND: "목적지 주변에서 자전거 경로를 찾지 못했습니다.",
  TOO_MANY_SEARCH_LINK: "경로 탐색 범위가 복잡해 경로를 계산하지 못했습니다.",
  TOO_FAR_AWAY: "출발지와 목적지 사이의 거리가 너무 멉니다.",
  ROUTE_RESULT_NOT_FOUND: "카카오에서 해당 구간의 자전거 경로를 찾지 못했습니다.",
};

function numericCoordinate(params: URLSearchParams, name: string, min: number, max: number) {
  const value = validCoordinate(params.get(name), min, max);
  if (value === null) throw new ApiFailure(`${name} 좌표를 확인해 주세요.`, 400);
  return value;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const startLng = numericCoordinate(params, "startLng", -180, 180);
    const startLat = numericCoordinate(params, "startLat", -90, 90);
    const endLng = numericCoordinate(params, "endLng", -180, 180);
    const endLat = numericCoordinate(params, "endLat", -90, 90);
    const modeParam = params.get("mode") ?? "BIKE_ONLY";
    if (modeParam !== "BIKE_ONLY" && modeParam !== "SHORTEST") {
      throw new ApiFailure("mode는 BIKE_ONLY 또는 SHORTEST여야 합니다.", 400);
    }
    const mode: RouteMode = modeParam;

    const url = new URL("https://dapi.kakao.com/v2/routing/bicycle");
    url.search = new URLSearchParams({
      start_x: String(startLng),
      start_y: String(startLat),
      end_x: String(endLng),
      end_y: String(endLat),
      route_mode: mode,
      input_coord: "WGS84",
      output_coord: "WGS84",
    }).toString();

    const restKey = serverKey("KAKAO_REST_API_KEY");
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `KakaoAK ${restKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiFailure("카카오 자전거 경로 API에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.");
    }

    let payload: KakaoRouteResponse;
    try {
      payload = (await response.json()) as KakaoRouteResponse;
    } catch {
      throw new ApiFailure("카카오 자전거 경로 API 응답을 읽지 못했습니다.");
    }
    if (!response.ok) {
      if (response.status === 401) throw new ApiFailure("카카오 REST 키 인증에 실패했습니다. KAKAO_REST_API_KEY를 확인해 주세요.", 502);
      if (response.status === 403) throw new ApiFailure("카카오맵 자전거 경로 API 권한이나 사용 설정을 확인해 주세요.", 502);
      if (response.status === 429) throw new ApiFailure("카카오 자전거 경로 API 호출 한도를 초과했습니다.", 429);
      throw new ApiFailure(`카카오 자전거 경로 API가 HTTP ${response.status} 오류를 반환했습니다.`);
    }
    if (payload.status !== "OK" || !payload.route) {
      throw new ApiFailure(statusMessages[payload.status ?? ""] ?? `카카오에서 경로를 반환하지 않았습니다 (${payload.status ?? "상태 없음"}).`, 422);
    }

    const points: KakaoPoint[] = [];
    const steps = payload.route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
    for (const step of steps) {
      for (const point of step.path?.points ?? []) {
        if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
          const previous = points.at(-1);
          if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
        }
      }
    }
    if (points.length < 2) throw new ApiFailure("카카오 경로 응답에 지도에 그릴 좌표가 없습니다.", 422);

    return NextResponse.json(
      {
        mode,
        distanceMeters: payload.route.properties?.totalDistance ?? 0,
        durationSeconds: payload.route.properties?.totalTime ?? 0,
        points,
        steps: steps.map((step) => ({ guidance: step.properties?.guidance ?? "", distanceMeters: step.properties?.distance ?? 0, durationSeconds: step.properties?.time ?? 0 })),
        landingUrl: payload.route.properties?.landingUrl ?? null,
        source: "Kakao Maps bicycle routing",
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
